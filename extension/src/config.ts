import { readFileSync } from "node:fs";
import { join } from "node:path";
import { DEFAULT_CONFIG, type CoordinatorConfig, type EngineId } from "./types.ts";

export type ConfigLoad = { readonly config: CoordinatorConfig; readonly notices: readonly string[] };

const ENGINES: readonly string[] = ["caveman", "headroom"] satisfies EngineId[];

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function decode(raw: unknown, notices: string[]): CoordinatorConfig {
  if (!isRecord(raw)) {
    if (raw !== undefined) notices.push("Coordinator configuration is not an object: defaults apply.");
    return DEFAULT_CONFIG;
  }
  const start = isRecord(raw.start) ? raw.start : {};
  const assignment: { provider: string; engine: string }[] = [];
  if (Array.isArray(raw.assignment)) {
    for (const entry of raw.assignment) {
      if (isRecord(entry) && typeof entry.provider === "string" && typeof entry.engine === "string") {
        assignment.push({ provider: entry.provider, engine: entry.engine });
      } else {
        notices.push("Skipped a malformed assignment entry: an entry needs a provider and an engine.");
      }
    }
  }
  const timeoutMs =
    typeof raw.timeoutMs === "number" && raw.timeoutMs > 0 ? raw.timeoutMs : DEFAULT_CONFIG.timeoutMs;
  return {
    start: {
      caveman: typeof start.caveman === "boolean" ? start.caveman : DEFAULT_CONFIG.start.caveman,
      headroom: typeof start.headroom === "boolean" ? start.headroom : DEFAULT_CONFIG.start.headroom,
    },
    assignment,
    timeoutMs,
  };
}

/** Configuration is optional; an absent file narrows nothing and leaves every default in place. */
export function loadConfig(stateDir: string, notices: string[] = []): ConfigLoad {
  const path = join(stateDir, "config.json");
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return { config: DEFAULT_CONFIG, notices };
  }
  return { config: decode(raw, notices), notices };
}

export function isKnownEngine(value: string): value is EngineId {
  return ENGINES.includes(value);
}
