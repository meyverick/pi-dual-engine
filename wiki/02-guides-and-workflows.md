---
okf_version: "0.2"
type: WikiPage
title: Module: Guides and Workflows
tier: practitioner
generated: { by: "agentic/0.8.1", at: "2026-11-02T00:00:00Z" }
status: draft
---

# Module: Guides and Workflows

## The daily loop

Work normally. The extension decides an owner per provider from model metadata,
and the model sees one recovery tool. Handles are dispatched by shape:
`ccr_...` goes to Caveman, 12-24 lowercase hex goes to Headroom, and anything
else is an explicit error that queries neither store.

## Configuration

Configuration is optional and lives in `config.json` inside the extension state
directory (`~/.pi/agent/dual-engine/`, or `DUAL_ENGINE_HOME`):

- `start.caveman` / `start.headroom`: both default to `true`. Set `false` when
  your own supervisor owns the process.
- `assignment`: pins a provider to `caveman` or `headroom`. Unlisted providers
  keep the derived assignment.
- `timeoutMs`: bounded wait for a started engine to prove its identity.
  Default 20000.

## Common changes

- **A provider routes to the wrong engine.** Check `/dual-engine` first: a
  provider only routes to an engine that proved the matching wire family and
  host. Unproven families stay direct by design.
- **A turn failed once against a dead proxy.** That is the documented residual:
  the breaker restores the direct endpoint after the first failed response, so
  the following turn runs direct.
- **Two providers, two Headroom processes.** Expected: Headroom maps one
  upstream per wire family per process.
