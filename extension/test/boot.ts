import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { HEADROOM_BASE_PORT, portForKey } from "../src/locks.ts";
import type { ProbeResult } from "../src/probe.ts";
import { createDualEngine } from "../src/index.ts";
import { type ChatModel, type FakePi, makePi } from "./fakes.ts";

const dirs: string[] = [];

export function cleanupDirs(): void {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
}

function tempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  dirs.push(dir);
  return dir;
}

export type BootOptions = {
  readonly models: readonly ChatModel[];
  readonly caveman?: ProbeResult;
  readonly headroom?: (provider: string) => ProbeResult;
  readonly exposure?: boolean;
  readonly config?: unknown;
  readonly mcpServers?: Record<string, unknown>;
  readonly extras?: { image?: readonly ChatModel[]; classifier?: readonly ChatModel[] };
};

export type Booted = {
  readonly pi: FakePi;
  readonly stateDir: string;
  readonly agentDir: string;
  readonly notices: { readonly type: string; readonly message: string }[];
};

export async function boot(options: BootOptions): Promise<Booted> {
  const stateDir = tempDir("dual-engine-state-");
  const cavemanHome = tempDir("dual-engine-caveman-");
  const agentDir = tempDir("dual-engine-agent-");
  if (options.config !== undefined) {
    writeFileSync(join(stateDir, "config.json"), JSON.stringify(options.config), "utf8");
  }
  if (options.mcpServers !== undefined) {
    writeFileSync(join(agentDir, "mcp.json"), JSON.stringify({ mcpServers: options.mcpServers }), "utf8");
  }
  mkdirSync(agentDir, { recursive: true });

  const pi = makePi(options.models, { exposure: options.exposure, extras: options.extras });
  const notify = (type: "info" | "warning" | "error", message: string) => pi.notices.push({ type, message });
  const providers = new Map<string, string>();
  let clock = 0;
  for (const model of options.models)
    providers.set(String(portForKey(HEADROOM_BASE_PORT, model.provider)), model.provider);

  createDualEngine({
    stateDir,
    cavemanHome,
    agentDir,
    deps: {
      notify,
      lifecycle: {
        stateDir,
        cavemanHome,
        timeoutMs: 50,
        spawn: () => ({ pid: undefined }),
        kill: () => {},
        now: () => clock,
        sleep: async (ms) => {
          clock += ms;
        },
        probeCaveman: async () => options.caveman ?? { ok: false, reason: "caveman down" },
        probeHeadroom: async ({ port }) => {
          const provider = providers.get(String(port)) ?? "";
          return options.headroom?.(provider) ?? { ok: false, reason: `headroom down for ${provider}` };
        },
      },
    },
  })(pi.api);

  await pi.emit("session_start", {});
  return { pi, stateDir, agentDir, notices: pi.notices };
}
