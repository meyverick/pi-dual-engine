import type { ProviderConfig } from "@earendil-works/pi-coding-agent";
import type { AssignmentPlan, ProviderGroup } from "./assignment.ts";
import { familyOf } from "./families.ts";
import type { EngineId } from "./types.ts";

export type ProviderApi = { registerProvider(name: string, config: ProviderConfig): void };

/**
 * One provider registration per plan: every carried model points at the engine's proxy, and every
 * family the engine cannot carry keeps its direct base URL.
 */
export function planProviderConfig(
  plan: AssignmentPlan,
  group: ProviderGroup,
  proxyUrl: string,
): ProviderConfig {
  const models = group.models.map((model) => {
    const family = familyOf(model.api);
    const carried = family !== undefined && plan.families.includes(family);
    return { ...model, baseUrl: carried ? proxyUrl : model.baseUrl };
  });
  return { baseUrl: proxyUrl, models } as ProviderConfig;
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
): Registration[] {
  const registrations: Registration[] = [];
  for (const plan of plans) {
    const port = ports.get(plan.provider);
    const group = groups.find((candidate) => candidate.provider === plan.provider);
    if (port === undefined || !group) continue;
    const config = planProviderConfig(plan, group, `http://127.0.0.1:${port}`);
    registrations.push({ provider: plan.provider, engine: plan.engine, config });
  }
  return registrations;
}

export function registerAll(api: ProviderApi, registrations: readonly Registration[]): void {
  for (const registration of registrations) {
    api.registerProvider(registration.provider, registration.config);
  }
}
