import { describe, expect, test } from "bun:test";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { Api, Model } from "@earendil-works/pi-ai";
import type { AssignmentPlan } from "../src/assignment.ts";
import { planProviderConfig } from "../src/providers.ts";
import { groupChatModels } from "../src/state.ts";

function regModel(overrides: Record<string, unknown> = {}): Model<Api> {
  return {
    provider: "aaa",
    id: "spark",
    name: "spark",
    api: "openai-completions",
    baseUrl: "https://a.example.com/v1",
    reasoning: false,
    input: ["text"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 1000,
    maxTokens: 100,
    ...overrides,
  } as unknown as Model<Api>;
}

function ctxWith(models: readonly Model<Api>[]): ExtensionContext {
  return {
    modelRegistry: {
      getModelsOfType: () => models,
      getAvailableOfType: async () => models,
    },
  } as unknown as ExtensionContext;
}

const plan: AssignmentPlan = {
  provider: "aaa",
  engine: "headroom",
  families: ["openai"],
  direct: [],
  upstreams: [],
};

describe("groupChatModels", () => {
  test("registry thinkingLevelMap and optionals survive ingest", async () => {
    const groups = await groupChatModels(
      ctxWith([
        regModel({
          thinkingLevelMap: { minimal: "minimal", low: "low", medium: "medium", high: "high", xhigh: "xhigh" },
          compat: { strict: true },
          inputLimits: { maxImages: 4 },
        }),
      ]),
    );
    const found = groups.find((group) => group.provider === "aaa")?.models[0] as
      | { thinkingLevelMap?: Record<string, string | null>; compat?: unknown; inputLimits?: unknown }
      | undefined;
    expect(found?.thinkingLevelMap?.["xhigh"]).toBe("xhigh");
    expect(found?.compat).toEqual({ strict: true });
    expect(found?.inputLimits).toEqual({ maxImages: 4 });
  });

  test("null-disabled levels survive ingest", async () => {
    const groups = await groupChatModels(
      ctxWith([regModel({ thinkingLevelMap: { off: null, minimal: null, low: "low" } })]),
    );
    const found = groups.find((group) => group.provider === "aaa")?.models[0]?.thinkingLevelMap as
      | Record<string, string | null>
      | undefined;
    expect(found && "off" in found && found["off"]).toBeNull();
    expect(found?.["low"]).toBe("low");
  });

  test("ingest to proxy config retains metadata end to end", async () => {
    const groups = await groupChatModels(
      ctxWith([
        regModel({
          thinkingLevelMap: { minimal: "minimal", low: "low", medium: "medium", high: "high", xhigh: "xhigh" },
        }),
      ]),
    );
    const group = groups.find((candidate) => candidate.provider === "aaa");
    if (!group) throw new Error("missing group");
    const config = planProviderConfig(plan, group, "http://127.0.0.1:8801");
    const models = config.models as { id: string; baseUrl: string; thinkingLevelMap?: Record<string, string | null> }[];
    const found = models.find((model) => model.id === "spark");
    expect(found?.baseUrl).toBe("http://127.0.0.1:8801");
    expect(found?.thinkingLevelMap?.["xhigh"]).toBe("xhigh");
  });
});
