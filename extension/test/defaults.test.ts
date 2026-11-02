import { describe, expect, test } from "bun:test";
import { loadConfig } from "../src/config.ts";
import { DEFAULT_CONFIG } from "../src/types.ts";

describe("ready-on-install defaults", () => {
  test("starting both engines is on and the wait covers a cold Python start", () => {
    expect(DEFAULT_CONFIG.start).toEqual({ caveman: true, headroom: true });
    expect(DEFAULT_CONFIG.timeoutMs).toBe(30_000);
  });

  test("an absent configuration narrows nothing", () => {
    const { config, notices } = loadConfig("/nonexistent/dual-engine-state");
    expect(config).toEqual(DEFAULT_CONFIG);
    expect(notices).toEqual([]);
  });
});
