import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { ensureEngine, stopOwned } from "../src/lifecycle.ts";
import { lockPath, readLock, takeLock } from "../src/locks.ts";
import { harness, identify } from "./harness.ts";

const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "dual-engine-"));
  dirs.push(dir);
  return dir;
}

function dirsPair(): { stateDir: string; cavemanHome: string } {
  return { stateDir: tempDir(), cavemanHome: tempDir() };
}

const upstreams = [
  { family: "openai" as const, url: "https://a.example.com/v1" },
  { family: "anthropic" as const, url: "https://a.example.com" },
  { family: "gemini" as const, url: "https://b.example.com/v1beta" },
];

describe("engine ownership and ports", () => {
  test("Headroom spawns one upstream flag per family and one process per provider", async () => {
    const h = harness({}, dirsPair());
    const first = await ensureEngine({ engine: "headroom", key: "aaa", start: true, upstreams }, h.deps);
    const second = await ensureEngine({ engine: "headroom", key: "bbb", start: true, upstreams }, h.deps);
    expect(h.spawns).toHaveLength(2);
    const args = h.spawns[0]?.args ?? [];
    expect(args).toContain("--openai-api-url");
    expect(args).toContain("--anthropic-api-url");
    expect(args).toContain("--gemini-api-url");
    expect(args.filter((arg) => arg === "--openai-api-url")).toHaveLength(1);
    if (first.ok && second.ok) expect(first.state.port).not.toBe(second.state.port);
  });

  test("a lock held by another live process blocks takeover", async () => {
    const dirs = dirsPair();
    const path = lockPath(dirs.stateDir, "caveman", "main");
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, JSON.stringify({ pid: process.ppid, port: 8787, startedAt: 0 }), "utf8");
    const h = harness({}, dirs);
    const result = await ensureEngine({ engine: "caveman", start: true }, h.deps);
    expect(result.ok).toBe(false);
    expect(h.spawns).toHaveLength(0);
    if (!result.ok) expect(result.reason).toContain("another session holds");
  });

  test("a lock naming a dead pid is taken over", () => {
    const dirs = dirsPair();
    const path = lockPath(dirs.stateDir, "caveman", "main");
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, JSON.stringify({ pid: 999_999, port: 8787, startedAt: 0 }), "utf8");
    expect(readLock(path)?.pid).toBe(999_999);
    expect(takeLock(path, 8787, () => 1)).toBe(true);
    expect(readLock(path)?.pid).toBe(process.pid);
  });

  test("only a process this session started is stopped", () => {
    const h = harness({}, dirsPair());
    stopOwned({ engine: "caveman", port: 8787, upstreams: [], owned: false }, h.deps);
    expect(h.kills).toHaveLength(0);
    const owned = { engine: "caveman" as const, port: 8787, upstreams: [], owned: true };
    const path = lockPath(h.deps.stateDir, "caveman", "main");
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, JSON.stringify({ pid: 5151, port: 8787, startedAt: 0 }), "utf8");
    stopOwned(owned, h.deps);
    expect(h.kills).toEqual([5151]);
    expect(readLock(path)).toBeUndefined();
  });

  test("adopted engines are never stopped at session end", async () => {
    const h = harness({ probeHeadroom: async () => identify("headroom", 8801, false) }, dirsPair());
    const result = await ensureEngine({ engine: "headroom", key: "aaa", start: true, upstreams }, h.deps);
    expect(result.ok).toBe(true);
    if (result.ok) stopOwned(result.state, h.deps);
    expect(h.kills).toHaveLength(0);
  });
});
