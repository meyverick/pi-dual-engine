import { createServer } from "node:net";
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export type Lock = { readonly pid: number; readonly port: number; readonly startedAt: number };

export const CAVEMAN_DEFAULT_PORT = 8787;
export const HEADROOM_BASE_PORT = 8788;

export function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export function readLock(path: string): Lock | undefined {
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as Partial<Lock>;
    if (typeof parsed.pid !== "number" || typeof parsed.port !== "number") return undefined;
    return { pid: parsed.pid, port: parsed.port, startedAt: parsed.startedAt ?? 0 };
  } catch {
    return undefined;
  }
}

export function writeLock(path: string, lock: Lock): void {
  mkdirSync(join(path, ".."), { recursive: true });
  const temp = `${path}.${process.pid}.tmp`;
  writeFileSync(temp, JSON.stringify(lock), "utf8");
  renameSync(temp, path);
}

/** Write the lock when free, or when the pid it names is dead. Never when that process is alive. */
export function takeLock(path: string, port: number, now: () => number): boolean {
  const existing = readLock(path);
  if (existing && existing.pid !== process.pid && isAlive(existing.pid)) return false;
  writeLock(path, { pid: process.pid, port, startedAt: now() });
  return true;
}

export function releaseLock(path: string): void {
  const existing = readLock(path);
  if (existing && existing.pid !== process.pid) return;
  rmSync(path, { force: true });
}

/** Remove a record this session wrote, whoever started the process it names. */
export function removeLock(path: string): void {
  rmSync(path, { force: true });
}

export function lockPath(stateDir: string, engine: string, key: string): string {
  return join(stateDir, "locks", `${engine}-${key}.json`);
}

/** Deterministic per-key port so two sessions agree on where an engine for that key should be. */
export function portForKey(base: number, key: string): number {
  let hash = 0;
  for (const char of key) hash = (hash * 31 + char.charCodeAt(0)) % 20;
  return base + hash;
}

/** Real port check: binding a loopback listener fails when something already owns the port. */
export function portIsFree(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = createServer();
    server.once("error", () => resolve(false));
    server.once("listening", () => server.close(() => resolve(true)));
    server.listen(port, "127.0.0.1");
  });
}
