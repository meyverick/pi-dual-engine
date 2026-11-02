import type { EngineId, EngineState, Family, ProviderFamily } from "./types.ts";

export type ProviderModel = {
  readonly id: string;
  readonly name: string;
  readonly api: string;
  readonly baseUrl?: string;
  readonly reasoning: boolean;
  readonly input: readonly ("text" | "image")[];
  readonly cost: {
    readonly input: number;
    readonly output: number;
    readonly cacheRead: number;
    readonly cacheWrite: number;
  };
  readonly contextWindow: number;
  readonly maxTokens: number;
};
export type ProviderGroup = { readonly provider: string; readonly models: readonly ProviderModel[] };

/** Family preference is policy about wire families, never about provider names. */
/** The engine that should carry a family when it is available, in preference order. */
export const PREFERENCE: Record<Family, readonly EngineId[]> = {
  openai: ["headroom", "caveman"],
  anthropic: ["headroom", "caveman"],
  gemini: ["caveman", "headroom"],
};

export type AssignmentPlan = {
  readonly provider: string;
  readonly engine: EngineId;
  readonly families: readonly Family[];
  readonly direct: readonly Family[];
  /** One upstream per family, in spawn order; duplicates of a family are not carried. */
  readonly upstreams: readonly { readonly family: Family; readonly url: string }[];
};

export type DeriveResult = {
  readonly plans: readonly AssignmentPlan[];
  readonly notices: readonly string[];
};

function familiesOf(
  group: ProviderGroup,
  familyOf: (api: string) => Family | undefined,
  hostOf: (url: string | undefined) => string,
) {
  const seen = new Map<string, ProviderFamily & { url: string }>();
  for (const model of group.models) {
    const family = familyOf(model.api);
    const host = hostOf(model.baseUrl);
    if (!family || !host) continue;
    seen.set(`${family}|${host}`, { family, host, url: model.baseUrl ?? "" });
  }
  return [...seen.values()];
}

function proves(engine: EngineState, target: ProviderFamily): boolean {
  return engine.upstreams.some(
    (upstream) => upstream.family === target.family && upstream.host === target.host,
  );
}

function chooseEngine(
  engines: readonly EngineState[],
  targets: readonly ProviderFamily[],
): EngineId | undefined {
  let best: { engine: EngineId; covered: number; rank: number } | undefined;
  for (const engine of engines) {
    const covered = targets.filter((target) => proves(engine, target)).length;
    if (covered === 0) continue;
    const rank = targets.reduce((sum, target) => {
      const order = PREFERENCE[target.family];
      const index = order.indexOf(engine.engine);
      return sum + (index === -1 ? order.length : index);
    }, 0);
    const candidate = { engine: engine.engine, covered, rank };
    if (
      !best ||
      candidate.covered > best.covered ||
      (candidate.covered === best.covered && candidate.rank < best.rank)
    ) {
      best = candidate;
    }
  }
  return best?.engine;
}

function resolveOverrides(overrides: readonly { readonly provider: string; readonly engine: string }[]): {
  valid: Map<string, EngineId>;
  notices: string[];
} {
  const notices: string[] = [];
  const valid = new Map<string, EngineId>();
  const counts = new Map<string, number>();
  for (const entry of overrides) {
    counts.set(entry.provider, (counts.get(entry.provider) ?? 0) + 1);
  }
  for (const entry of overrides) {
    if ((counts.get(entry.provider) ?? 0) > 1) {
      if (
        !notices.some((notice) => notice.includes(`Conflicting assignments for provider "${entry.provider}"`))
      ) {
        notices.push(`Conflicting assignments for provider "${entry.provider}": the derived engine applies.`);
      }
      continue;
    }
    if (entry.engine !== "caveman" && entry.engine !== "headroom") {
      notices.push(
        `Unknown engine "${entry.engine}" for provider "${entry.provider}": the derived engine applies.`,
      );
      continue;
    }
    valid.set(entry.provider, entry.engine);
  }
  return { valid, notices };
}

/**
 * Derive one engine per provider from model metadata and what each engine proved. No provider or
 * model name decides routing; anything unproven runs direct with one notice naming the family.
 */
export function deriveAssignments(
  groups: readonly ProviderGroup[],
  engines: readonly EngineState[],
  overrides: readonly { readonly provider: string; readonly engine: string }[],
  helpers: { familyOf: (api: string) => Family | undefined; hostOf: (url: string | undefined) => string },
): DeriveResult {
  const { valid, notices: overrideNotices } = resolveOverrides(overrides);
  const notices = [...overrideNotices];
  const plans: AssignmentPlan[] = [];

  for (const group of groups) {
    const targets = familiesOf(group, helpers.familyOf, helpers.hostOf);
    if (targets.length === 0) {
      notices.push(`Provider "${group.provider}" serves no wire family an engine can carry: running direct.`);
      continue;
    }
    const engine = valid.get(group.provider) ?? chooseEngine(engines, targets);
    if (!engine) {
      notices.push(
        `Provider "${group.provider}" serves ${targets.map((t) => t.family).join(", ")} with no engine that can carry it: running direct.`,
      );
      continue;
    }
    const state = engines.find((candidate) => candidate.engine === engine);
    const carried: { family: Family; url: string }[] = [];
    const direct: Family[] = [];
    for (const target of targets) {
      const already = carried.some((entry) => entry.family === target.family);
      if (state && proves(state, target) && !already)
        carried.push({ family: target.family, url: target.url });
      else if (!direct.includes(target.family)) direct.push(target.family);
    }
    if (carried.length === 0) {
      notices.push(`Provider "${group.provider}" cannot be carried by ${engine}: remaining direct.`);
      continue;
    }
    if (direct.length > 0) {
      notices.push(
        `Provider "${group.provider}": ${direct.join(", ")} routed direct because ${engine} cannot carry that family.`,
      );
    }
    plans.push({
      provider: group.provider,
      engine,
      families: carried.map((entry) => entry.family),
      direct,
      upstreams: carried,
    });
  }
  return { plans, notices };
}
