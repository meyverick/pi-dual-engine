---
okf_version: "0.2"
type: WikiPage
title: Module: Architecture and Internals
tier: advanced
generated: { by: "agentic/0.8.1", at: "2026-11-02T00:00:00Z" }
status: draft
---

# Module: Architecture and Internals

## Ownership invariant

Exactly one compression engine touches any given byte. Caveman owns the harness
layer: ruleset, voice, tool-result rewriting before the transcript. Headroom
owns the wire layer: request-body compression. The coordinator never forwards a
body through a second engine.

## Modules

| File | Responsibility |
|---|---|
| `src/index.ts` | Registers the retrieve tool, the status command and the session hooks. |
| `src/session.ts` | Opens a session: discover, start, derive, register, report. |
| `src/engine-pool.ts` | Discovery and lazy per-provider start. |
| `src/lifecycle.ts` | Verify, adopt, start, stop. Locks live in `src/locks.ts`. |
| `src/probe.ts` | Identity probes for both engines. |
| `src/assignment.ts` | Derives one engine per provider from model metadata. |
| `src/providers.ts` | Builds and applies per-session provider registrations. |
| `src/retrieve.ts` | Single retrieval tool and the engine dispatch. |
| `src/breaker.ts` | Restores a direct endpoint after a failed proxy route. |
| `src/status.ts` | Per-engine status, never a combined figure. |

## Sequence of a session

1. `session_start` probes both engines for identity. Nothing is started yet.
2. Providers are grouped from the live model registry; each distinct
   `(api, host)` pair is a wire family.
3. The engines a plan needs are started, in plan order, under a per-port lock.
4. The assignment is derived again with the engines that proved themselves, and
   one provider registration per Headroom-assigned provider is applied for this
   session only.
5. `prepareLoadout` hides both upstream retrieval tools while keeping them
   callable, so the model sees exactly one.

## Deliberate limits

- One MCP server registration ("headroom") serves the first ready Headroom
  instance; handles from a second instance resolve through that server's store.
  Assign providers to Caveman when their handles must stay independent.
- The breaker observes responses, not transport errors, so a dead-proxy window
  can cost one failed turn.
- OpenAI Responses bodies are not compressed unless the operator opts in.
