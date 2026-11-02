import { readFileSync } from "node:fs";
import { join } from "node:path";
import { cavemanFamilyOf, hostOf } from "./families.ts";
import type { EngineState, Family, Upstream } from "./types.ts";

export type ProbeResult =
  | { readonly ok: true; readonly state: EngineState }
  | {
      readonly ok: false;
      readonly reason: string;
      /** True when something answered on the port but its identity is not the one we need. */
      readonly occupied?: boolean;
    };

type Json = Record<string, unknown>;

const HEADROOM_SERVICE = "headroom-proxy";
const CAVEMAN_INSTANCE_HEADER = "x-caveman-instance";

const FAMILY_CONFIG_KEYS: readonly (readonly [string, Family])[] = [
  ["anthropic_api_url", "anthropic"],
  ["openai_api_url", "openai"],
  ["gemini_api_url", "gemini"],
];

/** Read a JSON object, or undefined when the file is absent or unreadable. */
export function readJson(path: string): Json | undefined {
  try {
    const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
    return parsed && typeof parsed === "object" ? (parsed as Json) : undefined;
  } catch {
    return undefined;
  }
}

async function getJson(url: string, timeoutMs: number): Promise<Json> {
  const response = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
  if (!response.ok) throw new Error(`${url} answered ${response.status}`);
  return (await response.json()) as Json;
}

function upstreamsFromTable(table: unknown, compat: boolean): Upstream[] {
  if (!table || typeof table !== "object") return [];
  const out: Upstream[] = [];
  for (const [key, value] of Object.entries(table as Json)) {
    if (typeof value !== "string") continue;
    const family = cavemanFamilyOf(key, compat);
    const host = hostOf(value);
    if (family && host) out.push({ family, host });
  }
  return out;
}

/** Where a Caveman proxy keeps its run state for one port. */
export function cavemanStatePath(home: string, port: number): string {
  return join(home, "run", `${port}.json`);
}

/**
 * Readiness is identity, not a listening socket: the run-state file must name this port, the
 * health listener must echo its instance token, and recovery must be served over MCP.
 */
export async function probeCaveman(options: {
  port: number;
  home: string;
  timeoutMs: number;
  owned: boolean;
}): Promise<ProbeResult> {
  const statePath = cavemanStatePath(options.home, options.port);
  const recorded = readJson(statePath);
  if (!recorded) return { ok: false, reason: `no Caveman run state at ${statePath}` };
  if (recorded.recovery_via_mcp !== true)
    return { ok: false, reason: "Caveman run state reports recovery_via_mcp false" };

  let headers: Headers;
  try {
    const response = await fetch(`http://127.0.0.1:${options.port}/health/live`, {
      signal: AbortSignal.timeout(options.timeoutMs),
    });
    if (!response.ok) return { ok: false, reason: `Caveman health answered ${response.status}` };
    headers = response.headers;
  } catch (error) {
    return { ok: false, reason: `Caveman health unreachable: ${(error as Error).message}` };
  }

  const token = headers.get(CAVEMAN_INSTANCE_HEADER);
  if (!token || token !== recorded.instance_token) {
    return {
      ok: false,
      occupied: true,
      reason: `port ${options.port} answers, but its instance token does not match the Caveman run state`,
    };
  }

  const upstreams = [
    ...upstreamsFromTable(recorded.provider_upstreams, false),
    ...upstreamsFromTable(recorded.compat_upstreams, true),
  ];
  return { ok: true, state: { engine: "caveman", port: options.port, upstreams, owned: options.owned } };
}

/**
 * Headroom proves itself with `/livez` plus the loopback `/health` config block, which names the
 * upstream each family reaches. A bare listener is never readiness.
 */
export async function probeHeadroom(options: {
  port: number;
  timeoutMs: number;
  owned: boolean;
  /** Upstreams the caller needs. A proxy serving different ones is a foreign instance, not readiness. */
  expect?: readonly Upstream[];
}): Promise<ProbeResult> {
  const base = `http://127.0.0.1:${options.port}`;
  try {
    const live = await getJson(`${base}/livez`, options.timeoutMs);
    if (live.service !== HEADROOM_SERVICE) {
      return {
        ok: false,
        occupied: true,
        reason: `port ${options.port} answers but is not a Headroom proxy`,
      };
    }
    const health = await getJson(`${base}/health`, options.timeoutMs);
    if (health.service !== HEADROOM_SERVICE) {
      return { ok: false, reason: `port ${options.port} is not a Headroom proxy` };
    }
    const config = (health.config ?? {}) as Json;
    const upstreams: Upstream[] = [];
    for (const [key, family] of FAMILY_CONFIG_KEYS) {
      const host = hostOf(typeof config[key] === "string" ? (config[key] as string) : undefined);
      if (host) upstreams.push({ family, host });
    }
    if (upstreams.length === 0) {
      return { ok: false, occupied: true, reason: `Headroom on port ${options.port} names no upstream` };
    }
    const served = (upstream: Upstream): string => `${upstream.family}@${upstream.host}`;
    const missing = (options.expect ?? []).filter(
      (expected) =>
        !upstreams.some((upstream) => upstream.family === expected.family && upstream.host === expected.host),
    );
    if (missing.length > 0) {
      return {
        ok: false,
        occupied: true,
        reason: `Headroom on port ${options.port} serves ${upstreams.map(served).join(", ")}; expected ${missing
          .map(served)
          .join(", ")}`,
      };
    }
    return { ok: true, state: { engine: "headroom", port: options.port, upstreams, owned: options.owned } };
  } catch (error) {
    return { ok: false, reason: `Headroom unreachable: ${(error as Error).message}` };
  }
}
