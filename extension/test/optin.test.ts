import { afterEach, describe, expect, test } from "bun:test";
import { HEADROOM_BASE_PORT, portForKey } from "../src/locks.ts";
import { boot, cleanupDirs } from "./boot.ts";
import { chatModel } from "./fakes.ts";

afterEach(cleanupDirs);

const models = [chatModel("aaa", "openai-responses", "a.example.com", "responses-model")];

const headroomUp = {
  ok: true as const,
  state: {
    engine: "headroom" as const,
    port: portForKey(HEADROOM_BASE_PORT, "aaa"),
    owned: false,
    upstreams: [{ family: "openai" as const, host: "a.example.com" }],
  },
};

describe("OpenAI Responses opt-in", () => {
  test("passthrough stays unset and the affected models are named once", async () => {
    const { notices } = await boot({ models, headroom: () => headroomUp });
    expect(process.env.HEADROOM_COMPRESS_PASSTHROUGH).toBeUndefined();
    const responses = notices.filter((notice) => notice.message.includes("OpenAI Responses models"));
    expect(responses).toHaveLength(1);
    expect(responses[0]?.message).toContain("aaa/responses-model");
    expect(responses[0]?.message).toContain("HEADROOM_COMPRESS_PASSTHROUGH=1");
  });

  test("no savings claim is made for those models", async () => {
    const { notices } = await boot({ models, headroom: () => headroomUp });
    const claim = notices.find((notice) => notice.message.includes("OpenAI Responses models"));
    expect(claim?.message.toLowerCase()).not.toContain("saving");
  });

  test("the notice is absent when no Responses model is carried", async () => {
    const plain = [chatModel("aaa", "openai-completions", "a.example.com")];
    const { notices } = await boot({ models: plain, headroom: () => headroomUp });
    expect(notices.some((notice) => notice.message.includes("OpenAI Responses models"))).toBe(false);
  });
});
