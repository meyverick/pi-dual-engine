/** Wire families an engine can carry, and the engines that coordinate them. */
export type Family = "anthropic" | "openai" | "gemini";

export type EngineId = "caveman" | "headroom";

/** The engines in stable preference-independent order. */
export const ENGINE_IDS: readonly EngineId[] = ["headroom", "caveman"];

/** An upstream an engine proved it can reach: a family served at a host. */
export type Upstream = { readonly family: Family; readonly host: string };

/** A running engine this session may route through. */
export type EngineState = {
  readonly engine: EngineId;
  readonly port: number;
  readonly upstreams: readonly Upstream[];
  /** True only when this session started the process; adopted engines are never stopped. */
  readonly owned: boolean;
  /** Caveman's proxy is started by its own door, so its own teardown is what stops it. */
  readonly shutdown?: "caveman";
  /** The lock key this instance was recorded under: a provider for the wire engine, otherwise "main". */
  readonly key?: string;
};

/** A distinct (family, host) pair across one provider's models. */
export type ProviderFamily = { readonly family: Family; readonly host: string };

/** The engine that owns a provider, plus the families it cannot carry. */
export type Assignment = {
  readonly provider: string;
  readonly engine: EngineId;
  readonly families: readonly Family[];
  readonly direct: readonly Family[];
};

/** The extension's optional configuration. Absent configuration narrows nothing. */
export type CoordinatorConfig = {
  readonly start: Record<EngineId, boolean>;
  readonly assignment: readonly { readonly provider: string; readonly engine: string }[];
  readonly timeoutMs: number;
};

export const DEFAULT_CONFIG: CoordinatorConfig = {
  start: { caveman: true, headroom: true },
  assignment: [],
  timeoutMs: 30_000,
};
