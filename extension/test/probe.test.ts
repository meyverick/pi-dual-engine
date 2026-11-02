import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { probeCaveman, probeHeadroom } from "../src/probe.ts";

const servers: Server[] = [];
const dirs: string[] = [];

afterAll(() => {
  for (const server of servers) server.close();
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
});

function listen(handle: Parameters<typeof createServer>[1]): Promise<number> {
  return new Promise((resolve) => {
    const server = createServer(handle);
    servers.push(server);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      resolve(typeof address === "object" && address ? address.port : 0);
    });
  });
}

function cavemanHome(port: number, state: Record<string, unknown>): string {
  const home = mkdtempSync(join(tmpdir(), "caveman-home-"));
  dirs.push(home);
  mkdirSync(join(home, "run"), { recursive: true });
  writeFileSync(join(home, "run", `${port}.json`), JSON.stringify(state), "utf8");
  return home;
}

const cavemanState = (token: string, extra: Record<string, unknown> = {}) => ({
  instance_token: token,
  recovery_via_mcp: true,
  provider_upstreams: {
    anthropic: "https://api.anthropic.com",
    "openai-codex": "https://chatgpt.com/backend-api",
  },
  compat_upstreams: { exchange: "https://exchange.example.com/v1" },
  ...extra,
});

describe("Caveman readiness", () => {
  test("identity match with a matching token is ready and publishes upstreams", async () => {
    const port = await listen((request, response) => {
      response.writeHead(200, { "x-caveman-instance": "tok" });
      response.end("ok");
      void request;
    });
    const home = cavemanHome(port, cavemanState("tok"));
    const result = await probeCaveman({ port, home, timeoutMs: 1000, owned: false });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.state.engine).toBe("caveman");
      expect(result.state.upstreams).toContainEqual({ family: "anthropic", host: "api.anthropic.com" });
      expect(result.state.upstreams).toContainEqual({ family: "openai", host: "chatgpt.com" });
      expect(result.state.upstreams).toContainEqual({ family: "openai", host: "exchange.example.com" });
    }
  });

  test("a mismatched instance token is not ready", async () => {
    const port = await listen((_request, response) => {
      response.writeHead(200, { "x-caveman-instance": "other" });
      response.end("ok");
    });
    const home = cavemanHome(port, cavemanState("tok"));
    const result = await probeCaveman({ port, home, timeoutMs: 1000, owned: false });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain("instance token");
  });

  test("missing recovery-over-MCP is not ready", async () => {
    const port = await listen((_request, response) => {
      response.writeHead(200, { "x-caveman-instance": "tok" });
      response.end("ok");
    });
    const home = cavemanHome(port, cavemanState("tok", { recovery_via_mcp: false }));
    const result = await probeCaveman({ port, home, timeoutMs: 1000, owned: false });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain("recovery_via_mcp");
  });

  test("a missing run state is not ready even when the port answers", async () => {
    const port = await listen((_request, response) => {
      response.writeHead(200);
      response.end("ok");
    });
    const home = mkdtempSync(join(tmpdir(), "caveman-home-"));
    dirs.push(home);
    const result = await probeCaveman({ port, home, timeoutMs: 1000, owned: false });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain("run state");
  });
});

describe("Headroom readiness", () => {
  const healthy = (request: { url?: string }, response: import("node:http").ServerResponse) => {
    if (request.url === "/livez") {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ service: "headroom-proxy", status: "healthy" }));
      return;
    }
    response.writeHead(200, { "content-type": "application/json" });
    response.end(
      JSON.stringify({
        service: "headroom-proxy",
        config: {
          anthropic_api_url: "https://api.anthropic.com",
          openai_api_url: "https://openrouter.ai/api/v1",
          gemini_api_url: null,
        },
      }),
    );
  };

  test("livez plus a loopback health config naming upstreams is ready", async () => {
    const port = await listen(healthy);
    const result = await probeHeadroom({ port, timeoutMs: 1000, owned: false });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.state.upstreams).toEqual([
        { family: "anthropic", host: "api.anthropic.com" },
        { family: "openai", host: "openrouter.ai" },
      ]);
    }
  });

  test("a foreign service on the port is refused", async () => {
    const port = await listen((_request, response) => {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ service: "something-else" }));
    });
    const result = await probeHeadroom({ port, timeoutMs: 1000, owned: false });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain("not a Headroom proxy");
  });

  test("a malformed body is not readiness", async () => {
    const port = await listen((_request, response) => {
      response.writeHead(200);
      response.end("not json");
    });
    const result = await probeHeadroom({ port, timeoutMs: 1000, owned: false });
    expect(result.ok).toBe(false);
  });

  test("a timeout is not readiness", async () => {
    const port = await listen(() => {
      // Never answer: the probe must time out rather than hang.
    });
    const result = await probeHeadroom({ port, timeoutMs: 100, owned: false });
    expect(result.ok).toBe(false);
  });

  test("health without a proven upstream is not readiness", async () => {
    const port = await listen((request, response) => {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(
        JSON.stringify({ service: "headroom-proxy", config: request.url === "/livez" ? undefined : {} }),
      );
    });
    const result = await probeHeadroom({ port, timeoutMs: 1000, owned: false });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain("no upstream");
  });
});
