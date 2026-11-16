# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## 0.2.2 - 2026-11-16

### Fixed
- Forward `thinkingLevelMap` (and optional `compat`, `inputLimits`) from registry models in `groupChatModels`, closing the last strip point end to end (follow-up to `0.2.1`, issue #4).

## 0.2.1 - 2026-11-16

### Fixed
- Preserve `thinkingLevelMap` (and optional `compat`, `inputLimits`) through `planProviderConfig` so re-registered models keep all supported thinking levels (`xhigh`/`max` no longer capped at `high`; `null`-disabled levels stay disabled).

## 0.2.0 - 2026-11-10

### Changed
- **BREAKING**: Rename npm package `pi-extension-dual-engine` -> `pi-dual-engine` (no behavior change; update Dependents to the new name).

### Fixed
- Windows `spawn caveman ENOENT` crash: npm `.cmd` shims resolve to direct `node` execution, native binaries run directly, no console window appears, and failed spawns degrade honestly instead of throwing `uncaughtException`.

### Added
- Root `bunfig.toml` scopes bare `bun test` discovery to first-party code, excluding read-only `references/` checkouts.

## 0.1.0 - 2026-11-02

### Added
- Initial project structure.
- `extension/`: the `dual-engine` pi extension. It derives one compression owner per
  provider from model metadata, verifies both engines by identity, adopts a running
  engine or starts an absent one under a per-port lock, registers Headroom-backed
  providers for the session only, and exposes a single `retrieve` tool that
  dispatches by recovery-handle shape.
- Six-slot module gate: format, lint, test and build lanes plus a headless pi smoke
  test that asserts one retrieval tool declaration.
- Module wiki covering install, configuration, internals and extension points.

### Fixed
- Derive from credentialed chat models only, so an unusable provider never influences routing.
- Register providers with an explicit model projection instead of runtime registry objects, which
  broke `registerProvider` for every assigned provider.
- Start the engines the current providers prefer before deriving, so a cold start is not a no-op.
- Treat a proxy serving a different upstream as a foreign instance: refuse it and never spawn onto
  its port.
- Stop started engines at session end: resolve the listening pid for Headroom's forked worker and
  use Caveman's own teardown for its proxy.
