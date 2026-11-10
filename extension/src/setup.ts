import { spawn as spawnProcess } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, extname, isAbsolute, join, resolve } from "node:path";
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

/** Windows npm shims (`.cmd`/`.bat`) cannot run via `CreateProcessW`; resolve them to a direct launch.
 * Mirrors `@caveman-ai/cli` `portableInvocation`: Node shims exec through `process.execPath`, real
 * binaries run directly, always with `shell: false` so no console window is allocated. */
const WINDOWS_SHIM_MAX_BYTES = 256 * 1024;
const WINDOWS_SHIM_MAX_DEPTH = 4;

function parseWindowsNestedShim(source: string): string | null {
  const match = source.match(/"([^"\r\n]+\.(?:cmd|bat))"[ \t]+%\*/i);
  return match?.[1] ?? null;
}

function parseWindowsNodeShim(source: string): string | null {
  const match = source.match(/["']?%_prog%["']?[ \t]+["']?%dp0%[\\/]([^"'\r\n]+)["']?[ \t]+%\*/i);
  return match?.[1] ?? null;
}

function parseWindowsExeShim(source: string): string | null {
  const match = source.match(/["']?%dp0%[\\/]([^"'\r\n]+\.exe)["']?[ \t]+%\*/i);
  return match?.[1] ?? null;
}

function resolveWindowsNodeShim(executable: string, depth = 0, seen = new Set<string>()): string {
  if (depth > WINDOWS_SHIM_MAX_DEPTH) throw new Error("Windows command shim nesting too deep");
  const normalized = resolve(executable);
  const key = normalized.toLowerCase();
  if (seen.has(key)) throw new Error("Windows command shim cycle");
  seen.add(key);
  const stat = statSync(normalized);
  if (!stat.isFile() || stat.size > WINDOWS_SHIM_MAX_BYTES) {
    throw new Error(`cannot safely launch Windows command shim: ${normalized}`);
  }
  const source = readFileSync(normalized, "utf8");
  const forwardsToBatch = /"[^"\r\n]+\.(?:cmd|bat)"[ \t]+%\*/i.test(source);
  const jsTarget = forwardsToBatch ? null : parseWindowsNodeShim(source);
  const nested = parseWindowsNestedShim(source);
  const exeTarget = forwardsToBatch || jsTarget ? null : parseWindowsExeShim(source);
  const child = jsTarget ?? nested ?? exeTarget;
  if (!child) throw new Error(`cannot safely launch non-Node Windows command shim: ${normalized}`);
  const target =
    /^[A-Za-z]:[\\/]/.test(child) || isAbsolute(child)
      ? child
      : resolve(dirname(normalized), ...child.split(/[\\/]+/));
  if (!existsSync(target) || !statSync(target).isFile()) {
    throw new Error(`Windows command shim target is missing: ${target}`);
  }
  if (jsTarget || (!nested && exeTarget)) return target;
  return resolveWindowsNodeShim(target, depth + 1, seen);
}

function resolveWindowsCommand(command: string, env: NodeJS.ProcessEnv = process.env): string | undefined {
  const pathExt = env.PATHEXT ?? ".COM;.EXE;.BAT;.CMD";
  const names = extname(command)
    ? [command]
    : pathExt.split(";").map((ext) => command + (ext.startsWith(".") ? ext : `.${ext}`));
  if (isAbsolute(command) || /[\\/]/.test(command)) {
    for (const name of names) if (existsSync(name)) return name;
    return existsSync(command) ? command : undefined;
  }
  for (const directory of (env.PATH ?? "").split(";")) {
    if (!directory) continue;
    for (const name of names) {
      const candidate = join(directory, name);
      if (existsSync(candidate)) return candidate;
    }
  }
  return undefined;
}

export function portableInvocation(
  command: string,
  args: readonly string[],
  platform = process.platform,
  env: NodeJS.ProcessEnv = process.env,
): { command: string; args: string[] } {
  if (platform !== "win32") return { command, args: [...args] };
  const executable = resolveWindowsCommand(command, env) ?? command;
  if (!/\.(?:cmd|bat)$/i.test(executable)) return { command: executable, args: [...args] };
  try {
    const target = resolveWindowsNodeShim(executable);
    return /\.exe$/i.test(target)
      ? { command: target, args: [...args] }
      : { command: process.execPath, args: [target, ...args] };
  } catch {
    return { command: executable, args: [...args] };
  }
}

/** Fire-and-forget daemon launch; failures are contained so the probe/degrade path reports them. */
function spawnDaemon(command: string, args: readonly string[]): { pid: number | undefined } {
  try {
    const inv = portableInvocation(command, args);
    const child = spawnProcess(inv.command, inv.args, {
      stdio: "ignore",
      detached: true,
      shell: false,
      windowsHide: true,
    });
    child.on("error", () => {});
    child.unref();
    return { pid: child.pid };
  } catch {
    return { pid: undefined };
  }
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
        // Detached so a launcher that forks a worker (headroom) still yields one killable group.
        return spawnDaemon(command, args);
      },
      cavemanStop: () => {
        spawnDaemon("caveman", ["stop"]);
      },
      // A spawned installer can exit before we stop it; ESRCH is normal, never fatal.
      kill: (pid) => {
        try {
          process.kill(-pid);
        } catch {
          try {
            process.kill(pid);
          } catch {
            // ESRCH: process already gone; nothing to stop.
          }
        }
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
