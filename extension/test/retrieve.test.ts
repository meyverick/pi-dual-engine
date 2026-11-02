import { describe, expect, test } from "bun:test";
import type { ExtensionToolContext } from "@earendil-works/pi-coding-agent";
import { createRetrieveTool, executeEngineTool, type EngineOutcome } from "../src/retrieve.ts";

type Call = { engine: "caveman" | "headroom"; handle: string };

function tool(resolve: (engine: "caveman" | "headroom", handle: string) => EngineOutcome) {
  const calls: Call[] = [];
  const definition = createRetrieveTool({
    resolve: async (engine, handle) => {
      calls.push({ engine, handle });
      return resolve(engine, handle);
    },
  });
  const run = (handle: string) =>
    definition.execute?.(
      "call-1",
      { handle },
      undefined as never,
      undefined as never,
      {} as ExtensionToolContext,
    ) as Promise<{ content: { type: string; text: string }[]; isError?: boolean }>;
  return { definition, calls, run };
}

describe("single retrieval surface", () => {
  test("upstream retrieval declarations are hidden and stay active", () => {
    const { definition } = tool(() => ({ content: [], isError: false }));
    const changes = definition.prepareLoadout?.({
      declared: [],
      callable: [],
      registered: [
        { name: "caveman_retrieve" },
        { name: "mcp__headroom__headroom_retrieve" },
        { name: "read" },
      ],
      getExposure: () => "direct",
      getNamespace: () => undefined,
      getPromptGuidelines: () => [],
    } as never);
    expect(changes?.hiddenDeclarations).toEqual(["caveman_retrieve", "mcp__headroom__headroom_retrieve"]);
    expect(Object.keys(changes ?? {})).toEqual(["hiddenDeclarations"]);
  });

  test("a Caveman handle reaches Caveman and a Headroom handle reaches Headroom", async () => {
    const { calls, run } = tool((engine) => ({ content: [{ type: "text", text: engine }], isError: false }));
    await run("ccr_abc123");
    await run("0aa4e9800c25");
    expect(calls).toEqual([
      { engine: "caveman", handle: "ccr_abc123" },
      { engine: "headroom", handle: "0aa4e9800c25" },
    ]);
  });

  test("an unknown shape queries no engine and fails loudly", async () => {
    const { calls, run } = tool(() => ({ content: [], isError: false }));
    const result = await run("not-a-handle");
    expect(calls).toHaveLength(0);
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain("Unrecognized recovery handle");
  });

  test("the engine's result is returned unchanged, including a large payload", async () => {
    const payload = "x".repeat(120_000);
    const { run } = tool(() => ({ content: [{ type: "text", text: payload }], isError: false }));
    const result = await run("ccr_abc123");
    expect(result.content).toHaveLength(1);
    expect(result.content[0]?.text).toBe(payload);
  });

  test("an engine error stays an error with its bytes intact", async () => {
    const { run } = tool(() => ({ content: [{ type: "text", text: "no such handle" }], isError: true }));
    const result = await run("0aa4e9800c25");
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toBe("no such handle");
  });

  test("the tool is named retrieve and takes a handle", () => {
    const { definition } = tool(() => ({ content: [], isError: false }));
    expect(definition.name).toBe("retrieve");
    expect(Object.keys(definition.parameters.properties)).toEqual(["handle"]);
  });
});

describe("engine dispatch through ctx.executeTool", () => {
  test("each engine is called by its own tool name and its bytes come back unchanged", async () => {
    const calls: { name: string; args: unknown }[] = [];
    const payload = "y".repeat(120_000);
    const ctx = {
      executeTool: async (name: string, args: unknown) => {
        calls.push({ name, args });
        return { result: { content: [{ type: "text", text: payload }] }, isError: false };
      },
    } as never;
    const caveman = await executeEngineTool(ctx, "caveman", "ccr_abc");
    const headroom = await executeEngineTool(ctx, "headroom", "0aa4e9800c25");
    expect(calls.map((call) => call.name)).toEqual(["caveman_retrieve", "mcp__headroom__headroom_retrieve"]);
    expect(calls[0]?.args).toEqual({ handle: "ccr_abc" });
    expect(caveman.content[0]).toEqual({ type: "text", text: payload });
    expect(headroom.isError).toBe(false);
  });

  test("a nested tool error is reported as an error, not thrown", async () => {
    const ctx = {
      executeTool: async () => ({ result: { content: [{ type: "text", text: "boom" }] }, isError: true }),
    } as never;
    const outcome = await executeEngineTool(ctx, "headroom", "0aa4e9800c25");
    expect(outcome.isError).toBe(true);
  });
});
