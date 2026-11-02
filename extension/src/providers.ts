import type { ProviderConfig } from "@earendil-works/pi-coding-agent";
import type { AssignmentPlan, ProviderGroup } from "./assignment.ts";
import { familyOf } from "./families.ts";
import type { EngineId } from "./types.ts";

export type ProviderApi = { registerProvider(name: string, config: ProviderConfig): void };

/** Non-chat models of a provider, carried through untouched so a registration never drops them. */
export type ModelExtras = ReadonlyMap<string, readonly Record<string, unknown>[]>;

/**
 * One provider registration per plan: every carried model points at the engine's proxy, and every
 * family the engine cannot carry keeps its direct base URL.
 */
export function planProviderConfig(
  plan: AssignmentPlan,
  group: ProviderGroup,
  proxyUrl: string,
  extras: ModelExtras = new Map(),
): ProviderConfig {
  const chat = group.models.map((model) => {
    const family = familyOf(model.api);
    const carried = family !== undefined && plan.families.includes(family);
    return { ...model, baseUrl: carried ? proxyUrl : model.baseUrl };
  });
  const rest = extras.get(plan.provider) ?? [];
  return { baseUrl: proxyUrl, models: [...chat, ...rest] } as ProviderConfig;
}

export type Registration = {
  readonly provider: string;
  readonly engine: EngineId;
  readonly config: ProviderConfig;
};

export function planRegistrations(
  plans: readonly AssignmentPlan[],
  groups: readonly ProviderGroup[],
  ports: ReadonlyMap<string, number>,
  extras: ModelExtras = new Map(),
): Registration[] {
  const registrations: Registration[] = [];
  for (const plan of plans) {
    const port = ports.get(plan.provider);
    const group = groups.find((candidate) => candidate.provider === plan.provider);
    if (port === undefined || !group) continue;
    const config = planProviderConfig(plan, group, `http://127.0.0.1:${port}`, extras);
    registrations.push({ provider: plan.provider, engine: plan.engine, config });
  }
  return registrations;
}

/** Register every plan; a failing registration is reported and never aborts the session. */
export function registerAll(
  api: ProviderApi,
  registrations: readonly Registration[],
  onError?: (message: string) => void,
): void {
  for (const registration of registrations) {
    try {
      api.registerProvider(registration.provider, registration.config);
    } catch (error) {
      onError?.(
        `Could not register "${registration.provider}": ${(error as Error).message}. Its models run direct.`,
      );
    }
  }
}
