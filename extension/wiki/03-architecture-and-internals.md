---
okf_version: "0.2"
type: WikiPage
title: dual-engine architecture and internals
tier: advanced
status: draft
---

# Architecture and internals

One engine owns any given byte. `families.ts` routes by model `api` token (`anthropic`, `gemini`, `openai`); images, classifiers, and unknown APIs never route. `handles.ts` routes recovery by handle shape without deciding the engine first.

Two topologies exist (see `README.md` - The two topologies): harness-only, where Caveman owns everything, and split, where each engine owns its layer. Stacking compression is refused: a byte already owned by one engine is never recompressed by the other.

Status semantics distinguish ready, degraded (one engine missing: the session still starts and reports which side is down), and down. Probe, breaker, and session modules own readiness, failure accounting, and lifecycle respectively.
