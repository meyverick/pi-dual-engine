import { afterEach, describe, expect, test } from "bun:test";
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { HEADROOM_BASE_PORT, portForKey } from "../src/locks.ts";
import { boot, cleanupDirs } from "./boot.ts";
import { chatModel } from "./fakes.ts";

afterEach(cleanupDirs);

const models = [
  chatModel("aaa", "openai-completions", "a.example.com"),
  chatModel("bbb", "google-generative-ai", "generativelanguage.googleapis.com"),
];

const healthyCaveman = {
  ok: true as const,
  state: {
    engine: "caveman" as const,
    port: 8787,
    owned: false,
    upstreams: [{ family: "gemini" as const, host: "generativelanguage.googleapis.com" }],
  },
};

const healthyHeadroom = (provider: string) =>
  provider === "aaa"
    ? {
        ok: true as const,
        state: {
          engine: "headroom" as const,
          port: portForKey(HEADROOM_BASE_PORT, provider),
          owned: false,
          upstreams: [{ family: "openai" as const, host: "a.example.com" }],
        },
      }
    : { ok: false as const, reason: "down" };

describe("extension surface", () => {
  test("the factory registers exactly one tool named retrieve", async () => {
    const { pi } = await boot({ models, caveman: healthyCaveman, headroom: healthyHeadroom });
    expect(pi.tools.map((tool) => tool.name)).toEqual(["retrieve"]);
  });

  test("no capability to hide declarations means no retrieve tool and one error notice", async () => {
    const { pi, notices } = await boot({
      models,
      caveman: healthyCaveman,
      headroom: healthyHeadroom,
      exposure: false,
    });
    expect(pi.tools).toHaveLength(0);
    expect(notices.filter((notice) => notice.type === "error")).toHaveLength(1);
    expect(notices[0]?.message).toContain("cannot hide tool declarations");
  });

  test("session start registers one Headroom MCP server in codemode and keeps retrieval callable", async () => {
    const { pi } = await boot({ models, caveman: healthyCaveman, headroom: healthyHeadroom });
    expect(pi.mcp).toHaveLength(1);
    const entry = pi.mcp[0];
    expect(entry?.name).toBe("headroom");
    expect(entry?.config.exposure).toBe("codemode");
    expect(entry?.config.toolExposure).toEqual({ headroom_retrieve: "codemode" });
    expect(entry?.config.args).toContain("--proxy-url");
  });

  test("provider registration points carried models at the proxy and keeps uncarried families direct", async () => {
    const mixed = [
      chatModel("aaa", "openai-completions", "a.example.com"),
      chatModel("aaa", "google-generative-ai", "gemini.example.com", "gemini-model"),
    ];
    const { pi, notices } = await boot({ models: mixed, caveman: healthyCaveman, headroom: healthyHeadroom });
    expect(pi.providers).toHaveLength(1);
    const config = pi.providers[0]?.config as { baseUrl: string; models: { id: string; baseUrl: string }[] };
    const port = portForKey(HEADROOM_BASE_PORT, "aaa");
    expect(config.baseUrl).toBe(`http://127.0.0.1:${port}`);
    expect(config.models.find((model) => model.id === "aaa-model")?.baseUrl).toBe(`http://127.0.0.1:${port}`);
    expect(config.models.find((model) => model.id === "gemini-model")?.baseUrl).toBe(
      "https://gemini.example.com/v1",
    );
    expect(notices.some((notice) => notice.message.includes("gemini routed direct"))).toBe(true);
  });

  test("a user mcp.json entry of the same name is reported, not fatal", async () => {
    const { pi, notices } = await boot({
      models,
      caveman: healthyCaveman,
      headroom: healthyHeadroom,
      mcpServers: { headroom: { url: "https://example.test/mcp" } },
    });
    expect(pi.mcp).toHaveLength(1);
    const override = notices.find((notice) => notice.message.includes("takes precedence"));
    expect(override?.message).toContain("mcp.json");
  });

  test("startup leaves user configuration byte-identical", async () => {
    const { pi, agentDir } = await boot({ models, caveman: healthyCaveman, headroom: healthyHeadroom });
    const files = {
      "settings.json": '{"theme":"dark"}\n',
      "models.json": '{"providers":{}}\n',
      "mcp.json": '{"mcpServers":{}}\n',
    };
    for (const [name, contents] of Object.entries(files))
      writeFileSync(join(agentDir, name), contents, "utf8");
    const before = new Map(
      Object.entries(files).map(([name]) => [name, readFileSync(join(agentDir, name), "utf8")]),
    );
    const listing = readdirSync(agentDir).sort();
    await pi.emit("session_start", {});
    for (const [name, contents] of before) {
      expect(readFileSync(join(agentDir, name), "utf8")).toBe(contents);
    }
    expect(readdirSync(agentDir).sort()).toEqual(listing);
  });

  test("the assignment report names every provider with its families and engine", async () => {
    const { stateDir } = await boot({ models, caveman: healthyCaveman, headroom: healthyHeadroom });
    const report = JSON.parse(readFileSync(join(stateDir, "assignment.json"), "utf8")) as {
      providers: { provider: string; engine: string | null; families: string[]; direct: string[] }[];
    };
    expect(report.providers).toEqual([
      { provider: "aaa", engine: "headroom", families: ["openai"], direct: [] },
      { provider: "bbb", engine: "caveman", families: ["gemini"], direct: [] },
    ]);
  });

  test("a provider with no chat models is reported direct and named once", async () => {
    const classifier = chatModel(
      "typesafe",
      "typesafe-classifier",
      "typesafe.example.com",
      "classifier-model",
    );
    const { notices, stateDir } = await boot({
      models,
      caveman: healthyCaveman,
      headroom: healthyHeadroom,
      extras: { classifier: [classifier] },
    });
    const report = JSON.parse(readFileSync(join(stateDir, "assignment.json"), "utf8")) as {
      providers: { provider: string; engine: string | null }[];
    };
    expect(report.providers.find((entry) => entry.provider === "typesafe")?.engine).toBeNull();
    const named = notices.filter((notice) => notice.message.includes("Non-chat providers"));
    expect(named).toHaveLength(1);
    expect(named[0]?.message).toContain("typesafe");
  });

  test("the status command reports each engine under its own label", async () => {
    const { pi } = await boot({ models, caveman: healthyCaveman, headroom: healthyHeadroom });
    const command = pi.commands.find((entry) => entry.name === "dual-engine");
    expect(command).toBeDefined();
    await command?.handler("", pi.ctx);
    const status = pi.notices.at(-1)?.message ?? "";
    expect(status).toContain("headroom (");
    expect(status).toContain("caveman (");
    expect(status.toLowerCase()).not.toContain("total");
  });
});
