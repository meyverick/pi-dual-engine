import type { Api, Model } from "@earendil-works/pi-ai";

export type BreakerState = {
  readonly tripped: Set<string>;
  readonly directModels: ReadonlyMap<string, Model<Api>>;
  readonly notify: (message: string) => void;
};

export type BreakerInput = {
  readonly event: { readonly status: number };
  readonly model: Model<Api> | undefined;
  readonly setModel: (model: Model<Api>) => Promise<boolean>;
};

/**
 * Restore the direct endpoint of the selected model once per provider after a proxy-backed route
 * fails. The next turn runs direct; later turns do not route that provider again.
 */
export async function onProviderResponse(state: BreakerState, input: BreakerInput): Promise<void> {
  if (input.event.status < 400) return;
  const model = input.model;
  if (!model) return;
  const provider = model.provider;
  const direct = state.directModels.get(provider);
  if (!direct || state.tripped.has(provider)) return;
  state.tripped.add(provider);
  const restored = await input.setModel(direct);
  state.notify(
    `Proxy route for "${provider}" failed with ${input.event.status}; ${
      restored ? "the selected model now uses its direct endpoint" : "restore the direct endpoint manually"
    }. This provider stays direct for the session.`,
  );
}
