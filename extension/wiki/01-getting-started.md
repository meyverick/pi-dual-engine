---
okf_version: "0.2"
type: WikiPage
title: Getting started with dual-engine
tier: beginner
status: draft
---

# Getting started with dual-engine

Three installs, no configuration file:

1. `caveman enable pi` puts the harness layer in place.
2. `uv tool install --python 3.13 "headroom-ai[proxy]"` puts the wire layer on `PATH`.
3. Install this package (`pi-dual-engine`) so pi loads `dist/index.js`.

Configuration only narrows: unlisted providers keep the derived assignment, an unknown engine name or a duplicated entry is skipped with one notice, and the session still starts.
