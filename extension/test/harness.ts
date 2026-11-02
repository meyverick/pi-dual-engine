import type { LifecycleDeps } from "../src/lifecycle.ts";
import type { ProbeResult } from "../src/probe.ts";

export type Harness = {
  readonly deps: LifecycleDeps;
  readonly spawns: { command: string; args: readonly string[] }[];
  readonly kills: number[];
  readonly clock: { value: number };
};

export function identify(engine: "caveman" | "headroom", port: number, owned: boolean): ProbeResult {
  return { ok: true, state: { engine, port, upstreams: [], owned } };
}

export function harness(
  overrides: Partial<LifecycleDeps>,
  dirs: { stateDir: string; cavemanHome: string },
): Harness {
  const spawns: { command: string; args: readonly string[] }[] = [];
  const kills: number[] = [];
  const clock = { value: 0 };
  const base: LifecycleDeps = {
    stateDir: dirs.stateDir,
    cavemanHome: dirs.cavemanHome,
    timeoutMs: 100,
    spawn: (command, args) => {
      spawns.push({ command, args });
      return { pid: 4242 };
    },
    kill: (pid) => kills.push(pid),
    now: () => clock.value,
    sleep: async (ms) => {
      clock.value += ms;
    },
    probeCaveman: async () => ({ ok: false, reason: "down" }),
    probeHeadroom: async () => ({ ok: false, reason: "down" }),
  };
  return { deps: { ...base, ...overrides }, spawns, kills, clock };
}
