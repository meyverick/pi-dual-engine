#!/usr/bin/env bun
/** Module gate: the six-slot contract for the extension package. */
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const root = join(import.meta.dir, "..");
const pkg = join(root, "extension");
const quick = process.argv.includes("--quick");
const failures: string[] = [];
const git = (...args: string[]): string => execFileSync("git", args, { cwd: root, encoding: "utf8" });
const EPIGRAPH = "> *Architected and directed by Human Intelligence, **implemented by AI**.*";

function lane(slot: string, args: string[], cwd = pkg): void {
  console.log(`  $ ${args.join(" ")}`);
  const result = spawnSync(args[0] as string, args.slice(1), { cwd, stdio: "inherit" });
  if (result.status !== 0) failures.push(`${slot} failed: ${args.join(" ")}`);
}

if (!existsSync(join(pkg, "package.json"))) {
  console.error("FAIL: extension/package.json missing");
  process.exit(1);
}

console.log("== 1/6 format ==");
lane("slot 1", ["bun", "run", "format"]);

console.log("== 2/6 lint ==");
lane("slot 2", ["bun", "run", "lint"]);

console.log("== 3/6 native lanes ==");
lane("slot 3", ["bun", "run", "test"]);
lane("slot 3", ["bun", "run", "build"]);

console.log("== 4/6 tracked assets and docs ==");
const readmePath = join(root, "README.md");
if (!existsSync(readmePath)) {
  failures.push("README.md missing");
} else {
  const readme = readFileSync(readmePath, "utf8");
  const lines = readme.split("\n");
  if (lines[0] !== EPIGRAPH) failures.push("README.md line 1 is not the mandated epigraph");
  if (lines[1] !== "") failures.push("README.md line 2 must be blank");
  if (!lines[2]?.startsWith("# ")) failures.push("README.md line 3 must be the title");
  if (/^```/m.test(readme)) failures.push("README.md must contain no fenced code block");
}
const tracked = git("ls-files", "wiki").split("\n").filter(Boolean);
if (tracked.length === 0) failures.push("wiki/ is not tracked by git");

if (quick) {
  if (failures.length > 0) {
    for (const failure of failures) console.error(`  X ${failure}`);
    console.error("FAIL: module gate");
    process.exit(1);
  }
  console.log("fast checks passed; clean-clone and smoke tests skipped (--quick)");
  process.exit(0);
}

console.log("== 5/6 clean-clone sandbox ==");
const tmp = mkdtempSync(join(tmpdir(), "workspace-clone-"));
try {
  execFileSync("git", ["clone", "-q", ".", tmp], { cwd: root });
  if (!existsSync(join(tmp, "README.md"))) failures.push("README.md missing in clean clone");
} finally {
  rmSync(tmp, { recursive: true, force: true });
}

console.log("== 6/6 smoke / runtime test ==");
lane("slot 6", ["bun", join(pkg, "scripts", "smoke.ts")], root);

if (failures.length > 0) {
  for (const failure of failures) console.error(`  X ${failure}`);
  console.error("FAIL: module gate");
  process.exit(1);
}
console.log("lane: OK");
