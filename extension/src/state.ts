import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { Api, Model } from "@earendil-works/pi-ai";
import type { AssignmentPlan, ProviderGroup } from "./assignment.ts";
import type { LifecycleDeps } from "./lifecycle.ts";
import type { EngineId, EngineState } from "./types.ts";

export type SessionState = {
  readonly engines: EngineState[];
  readonly ports: Map<string, number>;
  readonly directModels: Map<string, Model<Api>>;
  readonly counters: Map<string, { requests: number; failures: number }>;
  readonly tripped: Set<string>;
  readonly failures: Map<EngineId, string>;
  readonly plans: readonly AssignmentPlan[];
  readonly groups: readonly ProviderGroup[];
};

export type SessionDeps = {
  readonly lifecycle: LifecycleDeps;
  readonly notify: (type: "info" | "warning" | "error", message: string) => void;
  readonly start: { readonly caveman: boolean; readonly headroom: boolean };
  readonly overrides: readonly { readonly provider: string; readonly engine: string }[];
};

/** Every chat model of the session, grouped by the provider pi reports for it. */
export function groupChatModels(ctx: ExtensionContext): ProviderGroup[] {
  const grouped = new Map<string, { id: string; api: string; baseUrl?: string }[]>();
  for (const model of ctx.modelRegistry.getModelsOfType("chat")) {
    const list = grouped.get(model.provider) ?? [];
    list.push({ id: model.id, api: model.api, baseUrl: model.baseUrl });
    grouped.set(model.provider, list);
  }
  return [...grouped.entries()].map(([provider, models]) => ({ provider, models }));
}
