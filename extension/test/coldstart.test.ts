import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { HEADROOM_BASE_PORT, portForKey } from "../src/locks.ts";
import { createDualEngine } from "../src/index.ts";
import { type ChatModel, makePi } from "./fakes.ts";

const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "dual-engine-cold-"));
  dirs.push(dir);
  return dir;
}

const models: ChatModel[] = [
  {
    provider: "aaa",
    id: "aaa-model",
    name: "aaa-model",
    api: "openai-completions",
    baseUrl: "https://a.example.com/v1",
    reasoning: false,
    input: ["text"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 1000,
    maxTokens: 100,
  },
  {
    provider: "bbb",
    id: "bbb-model",
    name: "bbb-model",
    api: "google-generative-ai",
    baseUrl: "https://generativelanguage.googleapis.com/v1beta",
    reasoning: false,
    input: ["text"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 1000,
    maxTokens: 100,
  },
];

async function runCold(options: { start?: { caveman: boolean; headroom: boolean } } = {}) {
  const stateDir = tempDir();
  const cavemanHome = tempDir();
  const agentDir = tempDir();
  const spawned: { command: string; args: readonly string[] }[] = [];
  const pi = makePi(models);
  const providers = new Map<string, string>();
  for (const model of models)
    providers.set(String(portForKey(HEADROOM_BASE_PORT, model.provider)), model.provider);

  createDualEngine({
    stateDir,
    cavemanHome,
    agentDir,
    deps: {
      start: options.start ?? { caveman: true, headroom: true },
      notify: (type, message) => pi.notices.push({ type, message }),
      lifecycle: {
        stateDir,
        cavemanHome,
        timeoutMs: 100,
        spawn: (command, args) => {
          spawned.push({ command, args });
          return { pid: 4321 };
        },
        kill: () => {},
        now: () => 0,
        sleep: async () => {},
        probeCaveman: async () =>
          spawned.some((entry) => entry.command === "caveman")
            ? {
                ok: true,
                state: {
                  engine: "caveman",
                  port: 8787,
                  owned: true,
                  upstreams: [{ family: "gemini", host: "generativelanguage.googleapis.com" }],
                },
              }
            : { ok: false, reason: "down" },
        probeHeadroom: async ({ port }) => {
          if (!spawned.some((entry) => entry.command === "headroom")) return { ok: false, reason: "down" };
          const provider = providers.get(String(port)) ?? "";
          return {
            ok: true,
            state: {
              engine: "headroom",
              port,
              owned: true,
              upstreams: provider === "aaa" ? [{ family: "openai", host: "a.example.com" }] : [],
            },
          };
        },
      },
    },
  })(pi.api);

  await pi.emit("session_start", {});
  return { pi, spawned, stateDir };
}

describe("cold start with every engine stopped", () => {
  test("the engines the current providers prefer are started before an assignment is derived", async () => {
    const { pi, spawned } = await runCold();
    expect(spawned.map((entry) => entry.command).sort()).toEqual(["caveman", "headroom"]);
    expect(pi.providers.map((entry) => entry.name)).toEqual(["aaa"]);
    const config = pi.providers[0]?.config as { baseUrl: string };
    expect(config.baseUrl).toBe(`http://127.0.0.1:${portForKey(HEADROOM_BASE_PORT, "aaa")}`);
  });

  test("a started engine is recorded as owned so it stops with the session", async () => {
    const { pi } = await runCold();
    const status = pi.commands.find((entry) => entry.name === "dual-engine");
    await status?.handler("", pi.ctx);
    const report = pi.notices.at(-1)?.message ?? "";
    expect(report).toContain("headroom (started");
    expect(report).toContain("caveman (started");
  });

  test("start disabled keeps every provider direct and reports once per engine", async () => {
    const { pi, spawned } = await runCold({ start: { caveman: false, headroom: false } });
    expect(spawned).toHaveLength(0);
    expect(pi.providers).toHaveLength(0);
    expect(pi.notices.filter((notice) => notice.message.includes("is unavailable"))).toHaveLength(2);
  });
});
