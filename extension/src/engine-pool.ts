import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { ProviderGroup } from "./assignment.ts";
import { PREFERENCE, deriveAssignments } from "./assignment.ts";
import { familyOf, hostOf } from "./families.ts";
import { ensureEngine } from "./lifecycle.ts";
import { planRegistrations, registerAll } from "./providers.ts";
import type { SessionDeps, SessionState } from "./state.ts";
import type { EngineId, EngineState, Family } from "./types.ts";

export type Discovered = {
  readonly engines: EngineState[];
  readonly headroom: Map<string, EngineState>;
  readonly failures: Map<EngineId, string>;
};

/** Probe what is already running. Nothing is started here: adoption only. */
export async function discoverEngines(
  groups: readonly ProviderGroup[],
  deps: SessionDeps,
): Promise<Discovered> {
  const engines: EngineState[] = [];
  const headroom = new Map<string, EngineState>();
  const failures = new Map<EngineId, string>();

  const caveman = await ensureEngine({ engine: "caveman", start: false }, deps.lifecycle);
  if (caveman.ok) engines.push(caveman.state);
  else failures.set("caveman", caveman.reason);

  for (const group of groups) {
    const upstreams = group.models
      .map((model) => ({ family: familyOf(model.api), url: model.baseUrl ?? "" }))
      .filter((entry): entry is { family: NonNullable<typeof entry.family>; url: string } =>
        Boolean(entry.family && entry.url),
      )
      .map((entry) => ({ family: entry.family, url: entry.url }));
    const probe = await ensureEngine(
      { engine: "headroom", key: group.provider, start: false, upstreams },
      deps.lifecycle,
    );
    if (probe.ok) headroom.set(group.provider, probe.state);
    else failures.set("headroom", probe.reason);
  }
  engines.push(...headroom.values());
  return { engines, headroom, failures };
}

/** Start the engines a plan needs, in the order the plans need them. */
/**
 * Cold start has no proven plan yet, so the preference table drives it: the current provider's
 * families choose the engines that must come up before an assignment can be derived.
 */
export async function startNeeded(
  groups: readonly ProviderGroup[],
  currentProvider: string | undefined,
  discovered: Discovered,
  deps: SessionDeps,
): Promise<void> {
  const families = new Map<string, { family: NonNullable<ReturnType<typeof familyOf>>; url: string }[]>();
  for (const group of groups) {
    families.set(
      group.provider,
      group.models
        .map((model) => ({ family: familyOf(model.api), url: model.baseUrl ?? "" }))
        .filter((entry): entry is { family: NonNullable<ReturnType<typeof familyOf>>; url: string } =>
          Boolean(entry.family && entry.url),
        ),
    );
  }

  const wantsCaveman = [...families.values()].some((list) =>
    list.some((entry) => PREFERENCE[entry.family][0] === "caveman"),
  );
  if (wantsCaveman && !hasEngine(discovered, "caveman") && deps.start.caveman) {
    await startCaveman(discovered, deps);
  }

  if (currentProvider !== undefined)
    await startHeadroom(currentProvider, families.get(currentProvider) ?? [], discovered, deps);
}

function hasEngine(discovered: Discovered, engine: "caveman" | "headroom"): boolean {
  return discovered.engines.some((state) => state.engine === engine);
}

async function startCaveman(discovered: Discovered, deps: SessionDeps): Promise<void> {
  const probe = await ensureEngine({ engine: "caveman", start: true }, deps.lifecycle);
  if (probe.ok) {
    discovered.engines.push(probe.state);
    discovered.failures.delete("caveman");
  } else {
    discovered.failures.set("caveman", probe.reason);
  }
}

async function startHeadroom(
  provider: string,
  families: readonly { family: Family; url: string }[],
  discovered: Discovered,
  deps: SessionDeps,
): Promise<void> {
  if (discovered.headroom.has(provider) || !deps.start.headroom) return;
  if (!families.some((entry) => PREFERENCE[entry.family][0] === "headroom")) return;
  const upstreams = [...new Map(families.map((entry) => [entry.family, entry])).values()];
  const probe = await ensureEngine(
    { engine: "headroom", key: provider, start: true, upstreams },
    deps.lifecycle,
  );
  if (probe.ok) {
    discovered.headroom.set(provider, probe.state);
    discovered.engines.push(probe.state);
    discovered.failures.delete("headroom");
  } else {
    discovered.failures.set("headroom", probe.reason);
  }
}

/**
 * First selection of a provider is when its engine comes up. A provider the harness engine currently
 * carries is upgraded to the wire engine when the family preference wants it and it proves the host.
 */
export async function ensureProvider(
  api: ExtensionAPI,
  state: SessionState,
  provider: string,
  deps: SessionDeps,
): Promise<void> {
  const group = state.groups.find((entry) => entry.provider === provider);
  const families = (group?.models ?? [])
    .map((model) => ({ family: familyOf(model.api), url: model.baseUrl ?? "" }))
    .filter((entry): entry is { family: NonNullable<ReturnType<typeof familyOf>>; url: string } =>
      Boolean(entry.family && entry.url),
    );
  const wanted = families.some((entry) => PREFERENCE[entry.family][0] === "headroom");
  if (!wanted || state.ports.has(provider)) return;

  const upstreams = [...new Map(families.map((entry) => [entry.family, entry])).values()];
  const probe = await ensureEngine(
    { engine: "headroom", key: provider, start: deps.start.headroom, upstreams },
    deps.lifecycle,
  );
  if (!probe.ok) {
    deps.notify(
      "warning",
      `headroom could not start for "${provider}" (${probe.reason}); its models run direct.`,
    );
    return;
  }
  state.engines.push(probe.state);
  state.ports.set(provider, probe.state.port);
  if (!state.counters.has("headroom")) state.counters.set("headroom", { requests: 0, failures: 0 });

  const derived = deriveAssignments(state.groups, state.engines, deps.overrides, { familyOf, hostOf });
  const updated = derived.plans.find((plan) => plan.provider === provider);
  if (!updated) return;
  const index = state.plans.findIndex((plan) => plan.provider === provider);
  if (index >= 0) state.plans[index] = updated;
  if (updated.engine !== "headroom") return;
  registerAll(
    api,
    planRegistrations([updated], state.groups, new Map([[provider, probe.state.port]]), state.extras),
    (message) => deps.notify("warning", message),
  );
}
