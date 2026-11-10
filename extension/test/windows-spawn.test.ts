import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { portableInvocation } from "../src/setup.ts";

const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function fixtureDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "winspawn-"));
  dirs.push(dir);
  return dir;
}

function winEnv(dir: string): NodeJS.ProcessEnv {
  return { PATH: dir, PATHEXT: ".com;.exe;.bat;.cmd" };
}

test("non-Windows invocation passes through untouched", () => {
  const inv = portableInvocation("caveman", ["enable", "pi"], "darwin", {});
  expect(inv).toEqual({ command: "caveman", args: ["enable", "pi"] });
});

test("native .exe resolves directly with unchanged args", () => {
  const dir = fixtureDir();
  writeFileSync(join(dir, "headroom.exe"), "");
  const inv = portableInvocation("headroom", ["proxy", "--port", "8787"], "win32", winEnv(dir));
  expect(inv).toEqual({ command: join(dir, "headroom.exe"), args: ["proxy", "--port", "8787"] });
});

test("PATHEXT order prefers .exe over .cmd", () => {
  const dir = fixtureDir();
  writeFileSync(join(dir, "caveman.exe"), "");
  writeFileSync(join(dir, "caveman.cmd"), "ECHO off");
  const inv = portableInvocation("caveman", ["stop"], "win32", winEnv(dir));
  expect(inv).toEqual({ command: join(dir, "caveman.exe"), args: ["stop"] });
});

test("npm node shim resolves to process.execPath plus JS entry", () => {
  const dir = fixtureDir();
  const entry = join(dir, "node_modules", "caveman", "dist", "index.js");
  mkdirSync(join(dir, "node_modules", "caveman", "dist"), { recursive: true });
  writeFileSync(entry, "module.exports = {};");
  writeFileSync(
    join(dir, "caveman.cmd"),
    `@ECHO off\nSETLOCAL\n"%_prog%"  "%dp0%\\\\node_modules\\\\caveman\\\\dist\\\\index.js" %*\n`,
  );
  const inv = portableInvocation("caveman", ["enable", "pi"], "win32", winEnv(dir));
  expect(inv).toEqual({ command: process.execPath, args: [entry, "enable", "pi"] });
});

test("nested shim forwards through to the node entry", () => {
  const dir = fixtureDir();
  const entry = join(dir, "inner-entry.js");
  writeFileSync(entry, "module.exports = {};");
  writeFileSync(join(dir, "inner.cmd"), `"%_prog%" "%dp0%\\\\inner-entry.js" %*\n`);
  writeFileSync(join(dir, "outer.cmd"), `"${join(dir, "inner.cmd")}" %*\n`);
  const inv = portableInvocation("outer", [], "win32", winEnv(dir));
  expect(inv).toEqual({ command: process.execPath, args: [entry] });
});

describe("refusals fall back without throwing", () => {
  test("unparseable batch shim returns the shim path", () => {
    const dir = fixtureDir();
    writeFileSync(join(dir, "plain.cmd"), "@ECHO off\r\nECHO hello\r\n");
    const inv = portableInvocation("plain", ["x"], "win32", winEnv(dir));
    expect(inv).toEqual({ command: join(dir, "plain.cmd"), args: ["x"] });
  });

  test("shim cycle returns the shim path", () => {
    const dir = fixtureDir();
    writeFileSync(join(dir, "a.cmd"), `"${join(dir, "b.cmd")}" %*\n`);
    writeFileSync(join(dir, "b.cmd"), `"${join(dir, "a.cmd")}" %*\n`);
    const inv = portableInvocation("a", [], "win32", winEnv(dir));
    expect(inv).toEqual({ command: join(dir, "a.cmd"), args: [] });
  });

  test("shim with missing target returns the shim path", () => {
    const dir = fixtureDir();
    writeFileSync(join(dir, "ghost.cmd"), `"%_prog%" "%dp0%\\\\missing\\\\entry.js" %*\n`);
    const inv = portableInvocation("ghost", [], "win32", winEnv(dir));
    expect(inv).toEqual({ command: join(dir, "ghost.cmd"), args: [] });
  });

  test("unknown command returns the command unchanged", () => {
    const inv = portableInvocation("nope-not-here", ["x"], "win32", winEnv(""));
    expect(inv).toEqual({ command: "nope-not-here", args: ["x"] });
  });
});
