import type { AgentToolResult, ExtensionToolContext, ToolDefinition } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { RETRIEVAL_TOOL_CANDIDATES, resolveRetrievalTool } from "./families.ts";
import { dispatchHandle } from "./handles.ts";
import type { EngineId } from "./types.ts";

export type EngineOutcome = {
  readonly content: AgentToolResult<unknown>["content"];
  readonly isError: boolean;
};

export type RetrieveDeps = {
  /** Calls the engine's own retrieval tool. Never rejects for tool failures. */
  readonly resolve: (engine: EngineId, handle: string, ctx: ExtensionToolContext) => Promise<EngineOutcome>;
};

const parameters = Type.Object({
  handle: Type.String({
    description: "Recovery handle from a compression marker: ccr_... or 12-24 lowercase hex.",
  }),
});

function text(value: string): AgentToolResult<unknown> {
  return { content: [{ type: "text", text: value }], details: undefined };
}

/**
 * One model-visible retrieval tool. It owns no store: it dispatches by handle shape and returns
 * the owning engine's result unchanged.
 */
export function createRetrieveTool(deps: RetrieveDeps): ToolDefinition<typeof parameters> {
  return {
    name: "retrieve",
    label: "Retrieve",
    description:
      "Restore an original compressed by Caveman or Headroom. Pass the recovery handle exactly as it appeared in the marker.",
    parameters,
    prepareLoadout: (loadout) => ({
      hiddenDeclarations: Object.values(RETRIEVAL_TOOL_CANDIDATES)
        .flat()
        .filter((name) => loadout.registered.some((tool) => tool.name === name)),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const target = dispatchHandle(params.handle);
      if ("error" in target) {
        const failure = text(target.error);
        return { content: failure.content, details: undefined, isError: true };
      }
      const outcome = await deps.resolve(target.engine, target.handle, ctx);
      return { content: outcome.content, details: undefined, isError: outcome.isError };
    },
  };
}

/** Run the engine's own tool through the same validation, hooks and permission checks. */
export async function executeEngineTool(
  ctx: ExtensionToolContext,
  engine: EngineId,
  handle: string,
): Promise<EngineOutcome> {
  const callable = Array.isArray(ctx.tools) ? ctx.tools : [];
  // Caveman's own retrieval tool takes `recovery_handle`; its schema rejects any other spelling.
  const outcome = await ctx.executeTool(resolveRetrievalTool(engine, callable), { recovery_handle: handle });
  return { content: outcome.result.content, isError: outcome.isError };
}
