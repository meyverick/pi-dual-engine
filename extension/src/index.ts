import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { onProviderResponse } from "./breaker.ts";
import { ensureProvider } from "./engine-pool.ts";
import { createRetrieveTool, executeEngineTool } from "./retrieve.ts";
import { retrieveFromHeadroom } from "./headroom-http.ts";
import { closeSession, openSession } from "./session.ts";
import {
  type DualEngineOptions,
  buildDeps,
  canHideDeclarations,
  registerHeadroomMcp,
  resolvePaths,
} from "./setup.ts";
import type { SessionState } from "./state.ts";
import { buildStatus, formatStatus } from "./status.ts";

const NO_HIDE_NOTICE =
  "This pi version cannot hide tool declarations, so the single retrieval tool was not registered. Caveman and Headroom keep their own retrieval tools.";

export function createDualEngine(options: DualEngineOptions = {}) {
  return function dualEngine(pi: ExtensionAPI): void {
    const { deps, flush } = buildDeps(options);
    const { agentDir } = resolvePaths(options);
    let session: SessionState | undefined;
    let registered = false;

    /** Every live Headroom port this session knows about; any of them can serve any handle. */
    const headroomPorts = (): number[] => (session ? [...new Set(session.ports.values())] : []);

    pi.registerCommand("dual-engine", {
      description: "Report each compression engine separately: owner, port, providers, requests.",
      handler: async (_args, ctx) => {
        const report = session
          ? buildStatus({ engines: session.engines, assignments: session.plans, counters: session.counters })
          : undefined;
        ctx.ui.notify(report ? formatStatus(report) : "dual-engine: no session state yet.", "info");
      },
    });

    pi.on("session_start", async (_event, ctx) => {
      flush(ctx);
      // Action methods are unavailable during extension load, so the capability probe runs here.
      const capable = canHideDeclarations(pi);
      if (!capable) {
        ctx.ui.notify(NO_HIDE_NOTICE, "error");
      } else if (!registered) {
        registered = true;
        pi.registerTool(
          createRetrieveTool({
            // Caveman answers through its own registered tool; Headroom answers over HTTP, because
            // its CCR store is on disk and shared, and its MCP tool name depends on the MCP backend.
            resolve: (engine, handle, toolCtx) =>
              engine === "headroom"
                ? retrieveFromHeadroom(headroomPorts(), handle)
                : executeEngineTool(toolCtx, engine, handle),
          }),
        );
      }
      session = await openSession(pi, ctx, deps);
      const port = [...session.ports.values()][0];
      if (port !== undefined) registerHeadroomMcp(pi, ctx, port, agentDir);
    });

    pi.on("model_select", async (event) => {
      if (session) await ensureProvider(pi, session, event.model.provider, deps);
    });

    pi.on("after_provider_response", async (event, ctx) => {
      if (!session) return;
      const plan = session.plans.find((entry) => entry.provider === ctx.model?.provider);
      if (plan) {
        const counters = session.counters.get(plan.engine) ?? { requests: 0, failures: 0 };
        counters.requests += 1;
        if (event.status >= 400) counters.failures += 1;
        session.counters.set(plan.engine, counters);
      }
      await onProviderResponse(
        {
          tripped: session.tripped,
          directModels: session.directModels,
          notify: (message) => ctx.ui.notify(message, "warning"),
        },
        { event, model: ctx.model, setModel: (model) => pi.setModel(model) },
      );
    });

    pi.on("session_shutdown", async () => {
      if (session) closeSession(session, deps);
      session = undefined;
    });
  };
}

export type { DualEngineOptions };

export default createDualEngine();
