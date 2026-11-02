> *Architected and directed by Human Intelligence, **implemented by AI**.*

# dual-engine

A pi extension that runs Caveman and Headroom side by side without stacking compression: one engine owns a given byte, and the model sees one recovery tool.

## Install

Three installs, no configuration file:

1. `caveman enable pi` puts the harness layer in place.
2. `uv tool install --python 3.13 "headroom-ai[proxy]"` puts the wire layer on `PATH`. The `[proxy]`
   extra carries `fastapi`/`uvicorn`/`openai` and the MCP server; `[mcp]` alone can serve tools but
   cannot run `headroom proxy`. Use `[all]` for Headroom's full engine.
3. Install this package so pi loads `dist/index.js`: copy the directory under `~/.pi/agent/extensions/dual-engine/` (its `package.json` carries `pi.extensions`), or add it as a pi package.

On the first session the coordinator probes both engines, adopts one that already runs, starts one that is absent, derives which engine owns each provider, registers the Headroom-backed providers for this session only, and reports one retrieval tool. No file is edited, and no port is chosen by hand.

## The two topologies

- **T1, derived (default).** The wire family of each model decides the engine. Models whose API and base URL match a family an engine proves are carried by that engine; everything else runs direct. No provider name appears in the derivation. At session start the preferred engine comes up only for the selected provider, so providers nobody selects stay on the engine that already proves them, and upgrade on their first selection.
- **T2, assigned (opt-in).** Add `config.json` under the extension's state directory to pin one provider to one engine:

```json
{
  "start": { "caveman": true, "headroom": true },
  "assignment": [{ "provider": "example", "engine": "caveman" }],
  "timeoutMs": 30000
}
```

Configuration only narrows: unlisted providers keep the derived assignment, an unknown engine name or a duplicated entry is skipped with one notice, and the session still starts.

## Engine lifecycle

- Readiness is identity, not a listening socket. Caveman must answer `/health/live` with the instance token from its run-state file and report `recovery_via_mcp`; Headroom must answer `/livez` and name its upstreams in the loopback `/health` config block.
- An engine that already runs is adopted and outlives the session. A process this session started is the only one it ever stops.
- `start.enabled` defaults to **true** for both engines. Set `"start": { "caveman": false }` or `{ "headroom": false }` to defer to your own supervisor; the coordinator then reports the engine as unavailable and continues with the other one.
- Ports: Caveman keeps its own default (8787). Headroom gets one instance per provider, each with one upstream flag per wire family, on a deterministic port derived from the provider id so two sessions agree where to look.
- A per-port lock names the pid that started the engine; a lock whose pid is dead is taken over, a lock held by a live session is respected. The Headroom lock records the process actually listening on the port, because its launcher forks a worker into its own session.
- Caveman's own `execute.proxy` setting is authoritative: when it is `false`, `caveman enable pi` declines to spawn a proxy, and the coordinator degrades once to the wire engine instead of overriding that choice.
- Started engines stop at session end: Headroom by pid, Caveman through its own `caveman stop` door, because its proxy is a child of that door and not of the coordinator.
- Spawning is lazy in the sense that only the engines a plan needs come up: Caveman once, Headroom for the provider that is being used. A provider the harness engine currently carries is upgraded to the wire engine the first time that provider is selected, if it proves the host.
- Caveman is started through its own door (`caveman enable pi`), which installs its extension for subsequent sessions. If no Caveman proxy is running in the current session, the coordinator reports it once and continues on Headroom rather than spawning the proxy binary itself.

Notices the lifecycle can emit, once per session each:

- `<engine> is unavailable (<reason>). The session continues without it.`
- `headroom could not start for "<provider>" (<reason>); its models run direct.`
- `Provider "<provider>": <families> routed direct because <engine> cannot carry that family.`
- `Provider "<provider>" serves no wire family an engine can carry: running direct.`
- `Conflicting assignments for provider "<provider>": the derived engine applies.`
- `Unknown engine "<engine>" for provider "<provider>": the derived engine applies.`
- `Proxy route for "<provider>" failed with <status>; ... stays direct for the session.`
- `<mcp.json path> declares "headroom"; the user declaration takes precedence.`
- `Non-chat providers (<names>) are never routed through a compression engine.`
- `This pi version cannot hide tool declarations, so the single retrieval tool was not registered.`

## Retrieval

One `retrieve` tool is model-visible; dispatch is decided by the handle shape, never by trying engines in sequence.

| Handle | Path | Why |
|---|---|---|
| `ccr_*` | `ctx.executeTool("caveman_retrieve")` | Caveman's extension registers that tool; it owns the CCR store |
| 12-24 hex | `POST http://127.0.0.1:<port>/v1/retrieve` with `{"hash": handle}` | Headroom keeps one on-disk store per machine, so any live instance serves any handle |

The Headroom path deliberately does not depend on an MCP tool name. That name differs by backend (`mcp__headroom__headroom_retrieve` under pi's built-in MCP, a bare `headroom_retrieve` under an adapter that already prefixes by server name), and a server registered at runtime is not guaranteed to connect at all. Both names stay in the hidden set when they do exist. The MCP server is still registered for `headroom_compress` and `headroom_stats`; retrieval no longer needs it.

Options on the Headroom path, chosen for the smallest number of round trips: one request per live port, stopping at the first HTTP answer, because a `404` is store-wide and another instance cannot change it; only a transport failure falls through to the next live port; a 2 s bound per attempt; the store's own `detail` is returned verbatim on a miss.

## Assignment report

Every session writes `assignment.json` inside its state directory: one entry per provider with the engine that owns it, the families it carries, and the families left direct:

```json
{ "providers": [{ "provider": "example", "engine": "headroom", "families": ["openai"], "direct": ["gemini"] }] }
```

`engine: null` means the provider runs direct. The report is rewritten on every session and never touches user configuration.

## Status semantics

`/dual-engine` prints one labeled block per engine:

```text
headroom (adopted, port 8788)
  providers: example
  upstreams: openai@api.example.com
  requests: 12  failures: 0
```

The two blocks are never summed. Caveman measures harness work on the transcript, Headroom measures wire compression of request bodies; the bases differ, so a combined figure would be a fabricated number. Read each block as that engine's own report.

## Verified behaviour

- `bun test` covers handle dispatch, engine derivation, identity probes, lifecycle adoption and ownership, retrieval dispatch, the degradation matrix, and the no-writes guarantee for user configuration.
- `bun extension/scripts/smoke.ts` starts pi with the built extension, sends one prompt through a stub provider, and asserts the request declares exactly one retrieval tool.
