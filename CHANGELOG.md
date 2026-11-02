# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
