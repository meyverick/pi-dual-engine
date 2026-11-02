import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { deriveAssignments, type ProviderGroup } from "../src/assignment.ts";
import { familyOf, hostOf } from "../src/families.ts";
import type { EngineState } from "../src/types.ts";

const helpers = { familyOf, hostOf };

function engine(
  engineId: "caveman" | "headroom",
  upstreams: { family: "anthropic" | "openai" | "gemini"; host: string }[],
): EngineState {
  return { engine: engineId, port: 1000, upstreams, owned: false };
}

function group(provider: string, models: { api: string; baseUrl: string }[]): ProviderGroup {
  return {
    provider,
    models: models.map((model, index) => ({
      id: `${provider}-${index}`,
      name: `${provider}-${index}`,
      reasoning: false,
      input: ["text"],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: 1000,
      maxTokens: 100,
      ...model,
    })),
  };
}

describe("derived assignment", () => {
  test("a provider with a known wire family routes without configuration", () => {
    const groups = [group("zzz", [{ api: "openai-completions", baseUrl: "https://api.example.com/v1" }])];
    const engines = [engine("headroom", [{ family: "openai", host: "api.example.com" }])];
    const { plans } = deriveAssignments(groups, engines, [], helpers);
    expect(plans).toHaveLength(1);
    expect(plans[0]?.engine).toBe("headroom");
    expect(plans[0]?.families).toEqual(["openai"]);
  });

  test("a provider unknown to every engine runs direct with a notice", () => {
    const groups = [group("qqq", [{ api: "unknown-wire", baseUrl: "https://api.unknown.test/v1" }])];
    const engines = [engine("headroom", [{ family: "openai", host: "api.example.com" }])];
    const { plans, notices } = deriveAssignments(groups, engines, [], helpers);
    expect(plans).toHaveLength(0);
    expect(notices.some((notice) => notice.includes("qqq"))).toBe(true);
  });

  test("gemini on Google's host derives to the harness engine", () => {
    const groups = [
      group("rrr", [{ api: "google-generative-ai", baseUrl: "https://generativelanguage.googleapis.com" }]),
    ];
    const engines = [
      engine("caveman", [{ family: "gemini", host: "generativelanguage.googleapis.com" }]),
      engine("headroom", [{ family: "openai", host: "api.example.com" }]),
    ];
    const { plans } = deriveAssignments(groups, engines, [], helpers);
    expect(plans[0]?.engine).toBe("caveman");
  });

  test("multi-family provider is carried by one instance with one upstream per family", () => {
    const groups = [
      group("mmm", [
        { api: "openai-completions", baseUrl: "https://a.example.com/v1" },
        { api: "anthropic-messages", baseUrl: "https://a.example.com" },
        { api: "google-generative-ai", baseUrl: "https://b.example.com/v1beta" },
      ]),
    ];
    const engines = [
      engine("headroom", [
        { family: "openai", host: "a.example.com" },
        { family: "anthropic", host: "a.example.com" },
      ]),
    ];
    const { plans, notices } = deriveAssignments(groups, engines, [], helpers);
    expect(plans[0]?.families).toEqual(["openai", "anthropic"]);
    expect(plans[0]?.upstreams).toHaveLength(2);
    expect(plans[0]?.direct).toEqual(["gemini"]);
    expect(notices.some((notice) => notice.includes("gemini"))).toBe(true);
  });

  test("an explicit assignment beats the derived one and leaves others untouched", () => {
    const groups = [
      group("aaa", [{ api: "openai-completions", baseUrl: "https://a.example.com/v1" }]),
      group("bbb", [{ api: "openai-completions", baseUrl: "https://b.example.com/v1" }]),
    ];
    const engines = [
      engine("headroom", [
        { family: "openai", host: "a.example.com" },
        { family: "openai", host: "b.example.com" },
      ]),
      engine("caveman", [{ family: "openai", host: "a.example.com" }]),
    ];
    const { plans } = deriveAssignments(groups, engines, [{ provider: "aaa", engine: "caveman" }], helpers);
    expect(plans.find((plan) => plan.provider === "aaa")?.engine).toBe("caveman");
    expect(plans.find((plan) => plan.provider === "bbb")?.engine).toBe("headroom");
  });

  test("unknown engine names and conflicting entries are skipped with one notice each", () => {
    const groups = [group("aaa", [{ api: "openai-completions", baseUrl: "https://a.example.com/v1" }])];
    const engines = [engine("headroom", [{ family: "openai", host: "a.example.com" }])];
    const unknown = deriveAssignments(groups, engines, [{ provider: "aaa", engine: "bogus" }], helpers);
    expect(unknown.plans[0]?.engine).toBe("headroom");
    expect(unknown.notices).toHaveLength(1);

    const conflicting = deriveAssignments(
      groups,
      engines,
      [
        { provider: "aaa", engine: "caveman" },
        { provider: "aaa", engine: "headroom" },
      ],
      helpers,
    );
    expect(conflicting.plans[0]?.engine).toBe("headroom");
    expect(conflicting.notices).toHaveLength(1);
  });

  test("derivation code carries no provider or model names", () => {
    const source = readFileSync(join(import.meta.dir, "..", "src", "assignment.ts"), "utf8").toLowerCase();
    for (const name of [
      "openrouter",
      "commandcode",
      "opencode",
      "openai-codex",
      "typesafe",
      "xiaomi",
      "google",
    ]) {
      expect(source).not.toContain(name);
    }
  });

  test("a family the chosen engine cannot carry stays direct", () => {
    const groups = [
      group("aaa", [
        { api: "openai-completions", baseUrl: "https://a.example.com/v1" },
        { api: "google-generative-ai", baseUrl: "https://b.example.com/v1beta" },
      ]),
    ];
    const engines = [
      engine("headroom", [{ family: "openai", host: "a.example.com" }]),
      engine("caveman", [{ family: "gemini", host: "b.example.com" }]),
    ];
    const { plans } = deriveAssignments(groups, engines, [], helpers);
    const plan = plans[0];
    expect(plan?.families).toEqual(["openai"]);
    expect(plan?.direct).toEqual(["gemini"]);
    expect(plan?.upstreams.every((upstream) => upstream.family !== "gemini")).toBe(true);
  });
});
