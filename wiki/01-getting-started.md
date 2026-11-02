---
okf_version: "0.2"
type: WikiPage
title: Module: Getting Started
tier: beginner
generated: { by: "agentic/0.8.1", at: "2026-11-02T00:00:00Z" }
status: draft
---

# Module: Getting Started

## Prerequisites

- `bun`, the only script runtime in this repository.
- `pi` 1.4 or newer, which loads the extension from `extension/dist/index.js`.
- Optional at runtime: `caveman` on `PATH`, and `headroom` installed with
  `uv tool install --python 3.13 "headroom-ai[mcp]"`.

## Build and test

From this directory, `bun run --cwd extension build` writes the bundle, and
`bun run --cwd extension test` runs the unit tests. The full gate is
`bun scripts/check.ts`; `--quick` skips the clean-clone sandbox and the
headless smoke test.

## First successful run

Install both engines, install the extension directory under
`~/.pi/agent/extensions/dual-engine/`, then start pi. A first session prints at
most one notice per engine and lists a single `retrieve` tool. `/dual-engine`
reports what each engine owns.

If an engine is missing the session still starts: the remaining engine keeps its
half, and the missing one is named once.
