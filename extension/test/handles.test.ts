import { describe, expect, test } from "bun:test";
import { normalizeHandle, dispatchHandle } from "../src/handles.ts";

describe("handle dispatch", () => {
  const cases: { input: string; engine: "caveman" | "headroom" | "error" }[] = [
    { input: "ccr_0aa4e9800c2526914d4c1edb00b2cfa9", engine: "caveman" },
    { input: "0aa4e9800c25", engine: "headroom" },
    { input: "0aa4e9800c2526914d4c1edb", engine: "headroom" },
    { input: "<<ccr:ccr_abc123>>", engine: "caveman" },
    { input: "<<ccr:0aa4e9800c25>>", engine: "headroom" },
    { input: "ccr://ccr_abc123", engine: "caveman" },
    { input: "ccr://0aa4e9800c25", engine: "headroom" },
    { input: "", engine: "error" },
    { input: "not-a-handle", engine: "error" },
    { input: "0aa4e9800c25AB", engine: "error" },
    { input: "0aa4e9800c2526914d4c1edb00b2cfa9", engine: "error" },
    { input: "ccr_", engine: "error" },
  ];

  for (const { input, engine } of cases) {
    test(`"${input}" dispatches to ${engine}`, () => {
      const target = dispatchHandle(input);
      expect("engine" in target ? target.engine : "error").toBe(engine);
    });
  }

  test("normalization strips marker and scheme wrappers only", () => {
    expect(normalizeHandle("  <<ccr:ccr_abc>>  ")).toBe("ccr_abc");
    expect(normalizeHandle("ccr://ccr_abc")).toBe("ccr_abc");
    expect(normalizeHandle("ccr_abc")).toBe("ccr_abc");
  });

  test("an unrecognized shape never names an engine", () => {
    const target = dispatchHandle("randomword");
    expect("error" in target && target.error).toContain("Unrecognized recovery handle");
  });
});
