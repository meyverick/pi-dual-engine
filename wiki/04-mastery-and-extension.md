---
okf_version: "0.2"
type: WikiPage
title: Module: Mastery and Extension
tier: master
generated: { by: "agentic/0.8.1", at: "2026-11-02T00:00:00Z" }
status: draft
---

# Module: Mastery and Extension

## Reading the code as an invariant

Three invariants explain every module:

1. **One owner per byte.** `assignment.ts` produces one engine per provider, and
   `session.ts` registers nothing until that engine proved its identity.
2. **Never prevents use.** Every failure path returns the provider to its direct
   endpoint; configuration errors skip one entry, never the session.
3. **Attribute, do not aggregate.** `status.ts` labels each engine's figures
   separately because the measurement bases differ.

## Extending

- A new wire family is one entry in `families.ts` plus one entry in each
  engine's capability probe. Derivation then handles it with no provider list.
- A new engine is a descriptor, a probe and a spawn path; `assignment.ts` and
  `retrieve.ts` stay untouched.
- Handle shapes live in `handles.ts`. Adding a shape means adding a test row and
  one branch; never a fallback that tries engines in sequence.

## Verification lanes

- Unit tests pin the pure logic: derivation, dispatch, probes, locks, breaker.
- `scripts/smoke.ts` proves the built bundle loads in pi and that the request
  declares exactly one retrieval tool.
- `scripts/check.ts` runs the six-slot gate, including the clean-clone sandbox.

## Known trade-offs

Multi-instance Headroom retrieval resolves through one MCP server; the transport
breaker can cost one failed turn; OpenAI Responses needs an explicit opt-in.
Each is stated rather than promised away.
