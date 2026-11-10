---
okf_version: "0.2"
type: WikiPage
title: dual-engine guides and workflows
tier: intermediate
status: draft
---

# Guides and workflows

## Engine lifecycle

- Readiness is identity, not a listening socket. Caveman must answer `/health/live` with the instance token from its run-state file and report `recovery_via_mcp`; Headroom must answer `/livez` and name its upstreams in the loopback `/health` config block.
- An engine that already runs is adopted and outlives the session. A process this session started is stopped when the session closes.

## Retrieval

The model sees one recovery tool. Handles route by shape: `ccr_*` (Caveman) versus `[a-f0-9]{12,24}` (Headroom). Recovered content is not exempt from the harness rewrite.

## Assignment report

Per-provider engine assignment is reported at session start; unknown or duplicated entries are skipped with one notice each.
