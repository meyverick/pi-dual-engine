import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { deriveAssignments, type AssignmentPlan, type ProviderGroup } from "./assignment.ts";
import { discoverEngines, startPlanned } from "./engine-pool.ts";
import { familyOf, hostOf } from "./families.ts";
import { stopOwned } from "./lifecycle.ts";
import { planRegistrations, registerAll } from "./providers.ts";
import { type SessionDeps, type SessionState, groupChatModels } from "./state.ts";
import type { EngineId, EngineState } from "./types.ts";

const STATE_ORDER: readonly EngineId[] = ["caveman", "headroom"];

/**
 * Probe what runs, start only the engines a plan needs, then register every provider whose engine
 * proved its identity. An unproven engine never receives a provider.
 */
export async function openSession(
  api: ExtensionAPI,
  ctx: ExtensionContext,
  deps: SessionDeps,
): Promise<SessionState> {
  const groups = groupChatModels(ctx);
  const directModels = new Map<string, NonNullable<ExtensionContext["model"]>>();
  for (const model of ctx.modelRegistry.getModelsOfType("chat")) {
    if (!directModels.has(model.provider)) directModels.set(model.provider, model);
  }

  const discovered = await discoverEngines(groups, deps);
  const provisional = deriveAssignments(groups, discovered.engines, deps.overrides, { familyOf, hostOf });
  const currentProvider = ctx.model?.provider;
  await startPlanned(
    discovered,
    provisional.plans.filter((plan) => plan.provider === currentProvider),
    deps,
  );

  const derived = deriveAssignments(groups, discovered.engines, deps.overrides, { familyOf, hostOf });
  for (const notice of derived.notices) deps.notify("warning", notice);
  reportUncompressedResponses(groups, derived.plans, deps);

  const ports = new Map<string, number>();
  for (const [provider, state] of discovered.headroom) ports.set(provider, state.port);
  registerAll(
    api,
    planRegistrations(
      derived.plans.filter((plan) => plan.engine === "headroom" && ports.has(plan.provider)),
      groups,
      ports,
    ),
  );

  reportDegradation(deps, discovered.engines, discovered.failures);
  return {
    engines: discovered.engines,
    ports,
    directModels,
    counters: new Map(discovered.engines.map((engine) => [engine.engine, { requests: 0, failures: 0 }])),
    tripped: new Set<string>(),
    failures: discovered.failures,
    plans: derived.plans,
    groups,
  };
}

function reportUncompressedResponses(
  groups: readonly ProviderGroup[],
  plans: readonly AssignmentPlan[],
  deps: SessionDeps,
): void {
  const responses = groups
    .filter((group) => plans.some((plan) => plan.provider === group.provider && plan.engine === "headroom"))
    .flatMap((group) =>
      group.models
        .filter((model) => /responses/i.test(model.api))
        .map((model) => `${group.provider}/${model.id}`),
    );
  if (responses.length === 0) return;
  deps.notify(
    "info",
    `OpenAI Responses models (${responses.join(", ")}) are not compressed by default: set HEADROOM_COMPRESS_PASSTHROUGH=1 for the Headroom process to opt in.`,
  );
}

function reportDegradation(
  deps: SessionDeps,
  engines: readonly EngineState[],
  failures: Map<EngineId, string>,
): void {
  for (const engine of STATE_ORDER) {
    if (engines.some((candidate) => candidate.engine === engine)) continue;
    const reason = failures.get(engine);
    if (!reason) continue;
    deps.notify("warning", `${engine} is unavailable (${reason}). The session continues without it.`);
  }
}

export function closeSession(state: SessionState, deps: SessionDeps): void {
  for (const engine of state.engines) stopOwned(engine, deps.lifecycle);
}
