import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ensureEngine } from "../src/lifecycle.ts";
import { lockPath, readLock } from "../src/locks.ts";
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

describe("engine lifecycle", () => {
  test("a reachable engine with matching identity is adopted, not spawned", async () => {
    const h = harness({ probeCaveman: async () => identify("caveman", 8787, false) }, dirsPair());
    const result = await ensureEngine({ engine: "caveman", start: true }, h.deps);
    expect(result.ok).toBe(true);
    expect(h.spawns).toHaveLength(0);
    if (result.ok) expect(result.state.owned).toBe(false);
  });

  test("an absent engine starts under a lock and is verified before use", async () => {
    const dirs = dirsPair();
    let spawned = false;
    const h = harness(
      {
        spawn: () => {
          spawned = true;
          return { pid: 4242 };
        },
        probeCaveman: async () => (spawned ? identify("caveman", 8787, true) : { ok: false, reason: "down" }),
      },
      dirs,
    );
    const result = await ensureEngine({ engine: "caveman", start: true }, h.deps);
    expect(result.ok).toBe(true);
    expect(readLock(lockPath(dirs.stateDir, "caveman", "main"))?.pid).toBe(4242);
    if (result.ok) expect(result.state.owned).toBe(true);
  });

  test("a second session adopts the started engine and spawns nothing", async () => {
    const h = harness({ probeCaveman: async () => identify("caveman", 8787, false) }, dirsPair());
    await ensureEngine({ engine: "caveman", start: true }, h.deps);
    await ensureEngine({ engine: "caveman", start: true }, h.deps);
    expect(h.spawns).toHaveLength(0);
  });

  test("a started engine that never verifies is stopped and reported", async () => {
    const dirs = dirsPair();
    const h = harness({}, dirs);
    const result = await ensureEngine({ engine: "caveman", start: true }, h.deps);
    expect(result.ok).toBe(false);
    expect(h.kills).toEqual([4242]);
    expect(readLock(lockPath(dirs.stateDir, "caveman", "main"))).toBeUndefined();
  });

  test("start disabled reports without spawning", async () => {
    const h = harness({}, dirsPair());
    const result = await ensureEngine({ engine: "caveman", start: false }, h.deps);
    expect(result.ok).toBe(false);
    expect(h.spawns).toHaveLength(0);
  });
});
