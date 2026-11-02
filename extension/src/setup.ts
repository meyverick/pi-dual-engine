import { spawn as spawnProcess } from "node:child_process";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { loadConfig } from "./config.ts";
import { probeCaveman, probeHeadroom } from "./probe.ts";
import type { SessionDeps } from "./state.ts";

export const HEADROOM_MCP = "headroom";

type Notice = { readonly type: "info" | "warning" | "error"; readonly message: string };

export type DualEngineOptions = {
  readonly stateDir?: string;
  readonly cavemanHome?: string;
  readonly agentDir?: string;
  readonly deps?: Partial<SessionDeps>;
};

/** pi versions without exposure metadata cannot hide declarations, so no single retrieve tool is offered. */
export function canHideDeclarations(pi: ExtensionAPI): boolean {
  try {
    return pi.getAllTools().some((tool) => typeof (tool as { exposure?: unknown }).exposure === "string");
  } catch {
    return false;
  }
}

export function resolvePaths(options: DualEngineOptions): {
  stateDir: string;
  cavemanHome: string;
  agentDir: string;
} {
  return {
    stateDir:
      options.stateDir ?? process.env.DUAL_ENGINE_HOME ?? join(homedir(), ".pi", "agent", "dual-engine"),
    cavemanHome: options.cavemanHome ?? process.env.CAVEMAN_HOME ?? join(homedir(), ".caveman"),
    agentDir: options.agentDir ?? process.env.PI_CODING_AGENT_DIR ?? join(homedir(), ".pi", "agent"),
  };
}

/** Notices are collected until a session context exists, then flushed once. */
export function buildDeps(options: DualEngineOptions): {
  deps: SessionDeps;
  flush: (ctx: ExtensionContext) => void;
} {
  const { stateDir, cavemanHome } = resolvePaths(options);
  const { config } = loadConfig(stateDir);
  const pending: Notice[] = [];
  const seen = new Set<string>();
  const notify = (type: Notice["type"], message: string): void => {
    if (seen.has(message)) return;
    seen.add(message);
    pending.push({ type, message });
  };
  const base: SessionDeps = {
    start: config.start,
    overrides: config.assignment,
    notify,
    lifecycle: {
      stateDir,
      cavemanHome,
      timeoutMs: config.timeoutMs,
      spawn: (command, args) => {
        const child = spawnProcess(command, [...args], { stdio: "ignore", detached: false });
        child.unref();
        return { pid: child.pid };
      },
      // A spawned installer can exit before we stop it; ESRCH is normal, never fatal.
      kill: (pid) => {
        try {
          process.kill(pid);
        } catch {}
      },
      now: () => Date.now(),
      sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
      probeCaveman,
      probeHeadroom,
    },
  };
  return {
    deps: { ...base, ...options.deps, notify: options.deps?.notify ?? notify },
    flush: (ctx) => {
      for (const entry of pending.splice(0)) ctx.ui.notify(entry.message, entry.type);
    },
  };
}

function userDeclaresHeadroom(agentDir: string): string | undefined {
  const mcpPath = join(agentDir, "mcp.json");
  try {
    const raw = JSON.parse(readFileSync(mcpPath, "utf8")) as { mcpServers?: Record<string, unknown> };
    return raw.mcpServers?.[HEADROOM_MCP] ? mcpPath : undefined;
  } catch {
    return undefined;
  }
}

/** Register Headroom's MCP server for this session only; a user declaration of the same name wins. */
export function registerHeadroomMcp(
  pi: ExtensionAPI,
  ctx: ExtensionContext,
  port: number,
  agentDir: string,
): void {
  const declared = userDeclaresHeadroom(agentDir);
  if (declared) {
    ctx.ui.notify(`${declared} declares "${HEADROOM_MCP}"; the user declaration takes precedence.`, "info");
  }
  pi.registerMcpServer(HEADROOM_MCP, {
    command: "headroom",
    args: ["mcp", "serve", "--proxy-url", `http://127.0.0.1:${port}`],
    exposure: "codemode",
    toolExposure: { headroom_retrieve: "codemode" },
  });
}
