import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { Api, Model } from "@earendil-works/pi-ai";
import type { AssignmentPlan, ProviderGroup, ProviderModel } from "./assignment.ts";
import type { LifecycleDeps } from "./lifecycle.ts";
import type { ModelExtras } from "./providers.ts";
import type { EngineId, EngineState } from "./types.ts";

export type SessionState = {
  readonly engines: EngineState[];
  readonly ports: Map<string, number>;
  readonly directModels: Map<string, Model<Api>>;
  readonly counters: Map<string, { requests: number; failures: number }>;
  readonly tripped: Set<string>;
  readonly failures: Map<EngineId, string>;
  readonly plans: AssignmentPlan[];
  readonly groups: readonly ProviderGroup[];
  readonly extras: ModelExtras;
};

export type SessionDeps = {
  readonly lifecycle: LifecycleDeps;
  readonly notify: (type: "info" | "warning" | "error", message: string) => void;
  readonly start: { readonly caveman: boolean; readonly headroom: boolean };
  readonly overrides: readonly { readonly provider: string; readonly engine: string }[];
};

/** Every usable chat model, grouped by the provider pi reports for it. Unusable providers never route. */
export async function groupChatModels(ctx: ExtensionContext): Promise<ProviderGroup[]> {
  const grouped = new Map<string, ProviderModel[]>();
  const models = await ctx.modelRegistry
    .getAvailableOfType("chat")
    .catch(() => ctx.modelRegistry.getModelsOfType("chat"));
  for (const model of models) {
    const list = grouped.get(model.provider) ?? [];
    list.push({
      id: model.id,
      name: model.name,
      api: model.api,
      baseUrl: model.baseUrl,
      reasoning: model.reasoning,
      input: model.input,
      cost: model.cost,
      contextWindow: model.contextWindow,
      maxTokens: model.maxTokens,
    });
    grouped.set(model.provider, list);
  }
  return [...grouped.entries()].map(([provider, models]) => ({ provider, models }));
}
