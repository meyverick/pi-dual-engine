> *Architected and directed by Human Intelligence, **implemented by AI**.*

# pi-extensions Codebase

This directory is the single codebase submodule: it holds the application source, the domain packages and the native toolchain.

## Packages

| Package | What it is |
|---|---|
| `extension/` | `dual-engine`, a TypeScript pi extension that coordinates the Caveman harness engine with the Headroom wire engine. |

## Why it exists

Caveman and Headroom both compress agent context and both recover originals by handle. Run side by side without a coordinator they expose two retrieval tools, own two unrelated stores, and compete for the same bytes and port. `dual-engine` makes exactly one engine own any given byte, keeps a single model-visible recovery tool, and degrades honestly when one engine is missing.

## Working here

Everything runs through `bun`, from this directory:

- `bun run --cwd extension format` checks formatting.
- `bun run --cwd extension lint` runs the linter and the type checker.
- `bun run --cwd extension test` runs the unit tests.
- `bun run --cwd extension build` writes `extension/dist/index.js`.
- `bun scripts/check.ts` runs the six-slot gate; add `--quick` to skip the clean-clone sandbox and the headless smoke test.

## Documentation

- [Module wiki](wiki/index.md) walks from install to internals.
- [Extension guide](extension/README.md) covers configuration, engine lifecycle and notice text.
