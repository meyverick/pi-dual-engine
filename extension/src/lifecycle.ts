import {
  CAVEMAN_DEFAULT_PORT,
  isAlive,
  HEADROOM_BASE_PORT,
  lockPath,
  listeningPid,
  portForKey,
  readLock,
  releaseLock,
  removeLock,
  takeLock,
  writeLock,
} from "./locks.ts";
import type { ProbeResult, probeCaveman, probeHeadroom } from "./probe.ts";
import { hostOf } from "./families.ts";
import type { EngineState, Family, Upstream } from "./types.ts";

export type Spawned = { readonly pid: number | undefined };

export type LifecycleDeps = {
  /** The extension's own state directory: locks live here and nothing else is written. */
  readonly stateDir: string;
  readonly cavemanHome: string;
  readonly timeoutMs: number;
  readonly spawn: (command: string, args: readonly string[]) => Spawned;
  readonly kill: (pid: number) => void;
  /** Caveman's own teardown, used only for a proxy this session started through its door. */
  readonly cavemanStop?: () => void;
  readonly probeCaveman: typeof probeCaveman;
  readonly probeHeadroom: typeof probeHeadroom;
  readonly now: () => number;
  readonly sleep: (ms: number) => Promise<void>;
};

export type EnsureRequest =
  | { readonly engine: "caveman"; readonly start: boolean }
  | {
      readonly engine: "headroom";
      readonly key: string;
      readonly start: boolean;
      readonly upstreams: readonly { readonly family: Family; readonly url: string }[];
    };

function engineKey(request: EnsureRequest): string {
  return request.engine === "caveman" ? "main" : request.key;
}

/** The upstreams an engine instance must serve for this request to count as ours. */
function expected(request: EnsureRequest): readonly Upstream[] {
  if (request.engine === "caveman") return [];
  return request.upstreams
    .map((upstream) => ({ family: upstream.family, host: hostOf(upstream.url) }))
    .filter((upstream) => upstream.host !== "");
}

function enginePort(request: EnsureRequest): number {
  return request.engine === "caveman" ? CAVEMAN_DEFAULT_PORT : portForKey(HEADROOM_BASE_PORT, request.key);
}

function spawnEngine(request: EnsureRequest, port: number, deps: LifecycleDeps): Spawned {
  if (request.engine === "caveman") return deps.spawn("caveman", ["enable", "pi"]);
  const args = ["proxy", "--port", String(port)];
  const seen = new Set<Family>();
  for (const upstream of request.upstreams) {
    if (seen.has(upstream.family)) continue;
    seen.add(upstream.family);
    args.push(`--${upstream.family}-api-url`, upstream.url);
  }
  return deps.spawn("headroom", args);
}

async function waitForVerified(
  request: EnsureRequest,
  port: number,
  deps: LifecycleDeps,
): Promise<EngineState | undefined> {
  const deadline = deps.now() + deps.timeoutMs;
  for (;;) {
    const result =
      request.engine === "caveman"
        ? await deps.probeCaveman({ port, home: deps.cavemanHome, timeoutMs: 2_000, owned: true })
        : await deps.probeHeadroom({
            port,
            timeoutMs: 2_000,
            owned: true,
            expect: expected(request),
          });
    if (result.ok) return result.state;
    if (deps.now() >= deadline) return undefined;
    await deps.sleep(250);
  }
}

/**
 * Verify, adopt, then start. An adopted engine outlives the session; a stranger on the port is
 * refused; a child that fails verification is stopped again.
 */
export async function ensureEngine(request: EnsureRequest, deps: LifecycleDeps): Promise<ProbeResult> {
  const port = enginePort(request);
  const adopted =
    request.engine === "caveman"
      ? await deps.probeCaveman({ port, home: deps.cavemanHome, timeoutMs: 2_000, owned: false })
      : await deps.probeHeadroom({ port, timeoutMs: 2_000, owned: false, expect: expected(request) });
  if (adopted.ok) return adopted;
  // Something else owns the port: binding it again cannot succeed, and routing through it would be worse.
  if (adopted.occupied) return adopted;
  if (!request.start) return adopted;

  const path = lockPath(deps.stateDir, request.engine, engineKey(request));
  const recorded = readLock(path);
  if (!takeLock(path, port, deps.now)) return { ok: false, reason: `another session holds ${path}` };
  const child = spawnEngine(request, port, deps);
  const state = await waitForVerified(request, port, deps);
  if (state) {
    // Record the process that will still be listening later, not the launcher that may exit.
    const pid = request.engine === "headroom" ? (listeningPid(port) ?? child.pid) : child.pid;
    writeLock(path, { pid: pid ?? -1, port, startedAt: deps.now() });
    const tagged =
      request.engine === "caveman"
        ? { ...state, shutdown: "caveman" as const, key: engineKey(request) }
        : { ...state, key: engineKey(request) };
    return { ok: true, state: tagged };
  }
  if (child.pid !== undefined) deps.kill(child.pid);
  if (recorded?.pid === undefined) releaseLock(path);
  return { ok: false, reason: `${request.engine} did not verify within ${deps.timeoutMs} ms` };
}

/** Stop only the pid this session started for an engine it owns. */
/** Stop only what this session started, and only through the door that created it. */
export function stopOwned(
  state: EngineState,
  deps: Pick<LifecycleDeps, "stateDir" | "kill" | "cavemanStop">,
): void {
  if (!state.owned) return;
  const path = lockPath(
    deps.stateDir,
    state.engine,
    state.key ?? (state.engine === "caveman" ? "main" : String(state.port)),
  );
  const lock = readLock(path);
  if (state.shutdown === "caveman") deps.cavemanStop?.();
  else if (lock && lock.pid > 0 && isAlive(lock.pid)) deps.kill(lock.pid);
  removeLock(path);
}
