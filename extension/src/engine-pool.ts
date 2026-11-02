import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { ProviderGroup } from "./assignment.ts";
import { familyOf } from "./families.ts";
import { ensureEngine } from "./lifecycle.ts";
import { planRegistrations, registerAll } from "./providers.ts";
import type { SessionDeps, SessionState } from "./state.ts";
import type { EngineId, EngineState } from "./types.ts";

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
export async function startPlanned(
  discovered: Discovered,
  plans: readonly {
    provider: string;
    engine: EngineId;
    upstreams: readonly { family: string; url: string }[];
  }[],
  deps: SessionDeps,
): Promise<void> {
  for (const plan of plans) {
    if (plan.engine !== "headroom" || discovered.headroom.has(plan.provider)) continue;
    const probe = await ensureEngine(
      {
        engine: "headroom",
        key: plan.provider,
        start: deps.start.headroom,
        upstreams: plan.upstreams as never,
      },
      deps.lifecycle,
    );
    if (probe.ok) {
      discovered.headroom.set(plan.provider, probe.state);
      discovered.engines.push(probe.state);
      discovered.failures.delete("headroom");
    } else {
      discovered.failures.set("headroom", probe.reason);
    }
  }
}

/** Start the engine a provider needs the first time that provider is selected. */
export async function ensureProvider(
  api: ExtensionAPI,
  state: SessionState,
  provider: string,
  deps: SessionDeps,
): Promise<void> {
  const plan = state.plans.find((entry) => entry.provider === provider);
  if (!plan || plan.engine === "caveman" || state.ports.has(provider)) return;
  const probe = await ensureEngine(
    { engine: "headroom", key: provider, start: deps.start.headroom, upstreams: plan.upstreams },
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
  registerAll(api, planRegistrations([plan], state.groups, new Map([[provider, probe.state.port]])));
}

export function registerModelled(api: ExtensionAPI, ctx: ExtensionContext): void {
  void api;
  void ctx;
}
