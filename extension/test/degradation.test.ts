import { afterEach, describe, expect, test } from "bun:test";
import { HEADROOM_BASE_PORT, portForKey } from "../src/locks.ts";
import { boot, cleanupDirs } from "./boot.ts";
import { chatModel } from "./fakes.ts";

afterEach(cleanupDirs);

const models = [
  chatModel("aaa", "openai-completions", "a.example.com"),
  chatModel("bbb", "google-generative-ai", "generativelanguage.googleapis.com"),
];

const cavemanUp = {
  ok: true as const,
  state: {
    engine: "caveman" as const,
    port: 8787,
    owned: false,
    upstreams: [{ family: "gemini" as const, host: "generativelanguage.googleapis.com" }],
  },
};

const headroomUp = {
  ok: true as const,
  state: {
    engine: "headroom" as const,
    port: portForKey(HEADROOM_BASE_PORT, "aaa"),
    owned: false,
    upstreams: [{ family: "openai" as const, host: "a.example.com" }],
  },
};

describe("honest degradation", () => {
  test("wire engine missing: one notice, nothing registered on its behalf", async () => {
    const { pi, notices } = await boot({ models, caveman: cavemanUp });
    expect(pi.providers).toHaveLength(0);
    expect(pi.mcp).toHaveLength(0);
    const matching = notices.filter((notice) => notice.message.includes("headroom is unavailable"));
    expect(matching).toHaveLength(1);
    expect(matching[0]?.message).toContain("continues without it");
  });

  test("harness engine missing: one notice and the wire engine still serves its providers", async () => {
    const { pi, notices } = await boot({ models, headroom: () => headroomUp });
    expect(pi.providers.map((entry) => entry.name)).toEqual(["aaa"]);
    const matching = notices.filter((notice) => notice.message.includes("caveman is unavailable"));
    expect(matching).toHaveLength(1);
  });

  test("both missing: one notice per engine and the session still starts uncompressed", async () => {
    const { pi, notices } = await boot({ models });
    expect(pi.providers).toHaveLength(0);
    expect(pi.mcp).toHaveLength(0);
    expect(notices.filter((notice) => notice.message.includes("is unavailable"))).toHaveLength(2);
    expect(pi.tools.map((tool) => tool.name)).toEqual(["retrieve"]);
  });

  test("register after proof: a failing identity registers no provider for it", async () => {
    const failing = { ok: false as const, reason: "instance token mismatch" };
    const { pi, notices } = await boot({ models, caveman: cavemanUp, headroom: () => failing });
    expect(pi.providers).toHaveLength(0);
    expect(notices.some((notice) => notice.message.includes("headroom is unavailable"))).toBe(true);
  });

  test("providers assigned to the harness engine are never registered against the wire engine", async () => {
    const { pi } = await boot({ models, caveman: cavemanUp, headroom: () => headroomUp });
    expect(pi.providers.map((entry) => entry.name)).toEqual(["aaa"]);
  });
});
