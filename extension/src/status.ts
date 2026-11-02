export type EngineCounters = { readonly requests: number; readonly failures: number };

export type EngineSection = {
  readonly engine: string;
  readonly port: number;
  readonly mode: "started" | "adopted";
  readonly upstreams: readonly string[];
  readonly providers: readonly string[];
  readonly requests: number;
  readonly failures: number;
};

export type StatusReport = {
  readonly sections: readonly EngineSection[];
  /** Deliberately absent: the two measurement bases are not summable. */
  readonly combined?: never;
};

export type StatusInput = {
  readonly engines: readonly {
    readonly engine: string;
    readonly port: number;
    readonly owned: boolean;
    readonly upstreams: readonly { readonly family: string; readonly host: string }[];
  }[];
  readonly assignments: readonly { readonly provider: string; readonly engine: string }[];
  readonly counters: ReadonlyMap<string, EngineCounters>;
};

/** Report each engine separately and label the source. Never a combined figure. */
export function buildStatus(input: StatusInput): StatusReport {
  const sections = input.engines.map((engine) => {
    const counters = input.counters.get(engine.engine) ?? { requests: 0, failures: 0 };
    return {
      engine: engine.engine,
      port: engine.port,
      mode: engine.owned ? ("started" as const) : ("adopted" as const),
      upstreams: engine.upstreams.map((upstream) => `${upstream.family}@${upstream.host}`),
      providers: input.assignments
        .filter((entry) => entry.engine === engine.engine)
        .map((entry) => entry.provider),
      requests: counters.requests,
      failures: counters.failures,
    };
  });
  return { sections };
}

/** Human-readable status, one labeled block per engine. */
export function formatStatus(report: StatusReport): string {
  if (report.sections.length === 0) return "dual-engine: no engine is active; every provider runs direct.";
  return report.sections
    .map((section) => {
      const providers = section.providers.length > 0 ? section.providers.join(", ") : "none";
      const upstreams = section.upstreams.length > 0 ? section.upstreams.join(", ") : "none";
      return [
        `${section.engine} (${section.mode}, port ${section.port})`,
        `  providers: ${providers}`,
        `  upstreams: ${upstreams}`,
        `  requests: ${section.requests}  failures: ${section.failures}`,
      ].join("\n");
    })
    .join("\n");
}
