import { describe, expect, test } from "bun:test";
import type { AssignmentPlan, ProviderGroup } from "../src/assignment.ts";
import { planProviderConfig, planRegistrations, registerAll } from "../src/providers.ts";

const plan: AssignmentPlan = {
  provider: "aaa",
  engine: "headroom",
  families: ["openai"],
  direct: ["gemini"],
  upstreams: [{ family: "openai", url: "https://a.example.com/v1" }],
};

const group: ProviderGroup = {
  provider: "aaa",
  models: [
    { id: "chat", api: "openai-completions", baseUrl: "https://a.example.com/v1" },
    { id: "gemini", api: "google-generative-ai", baseUrl: "https://b.example.com/v1" },
  ],
};

describe("provider registration", () => {
  test("carried models point at the proxy, uncarried families keep their base URL", () => {
    const config = planProviderConfig(plan, group, "http://127.0.0.1:8801");
    const models = config.models as { id: string; baseUrl: string }[];
    expect(models.find((model) => model.id === "chat")?.baseUrl).toBe("http://127.0.0.1:8801");
    expect(models.find((model) => model.id === "gemini")?.baseUrl).toBe("https://b.example.com/v1");
  });

  test("non-chat models are carried through a registration untouched", () => {
    const extras = new Map([["aaa", [{ id: "image-model", api: "openai-images" }]]]);
    const config = planProviderConfig(plan, group, "http://127.0.0.1:8801", extras);
    const ids = (config.models as { id: string }[]).map((model) => model.id);
    expect(ids).toEqual(["chat", "gemini", "image-model"]);
  });

  test("registrations are skipped for providers without a proven port", () => {
    const registrations = planRegistrations([plan], [group], new Map());
    expect(registrations).toHaveLength(0);
  });

  test("a failing registration is reported and the next one still lands", () => {
    const errors: string[] = [];
    const registered: string[] = [];
    const api = {
      registerProvider: (name: string) => {
        if (name === "aaa") throw new Error("auth missing");
        registered.push(name);
      },
    };
    registerAll(
      api,
      [
        { provider: "aaa", engine: "headroom", config: {} },
        { provider: "bbb", engine: "headroom", config: {} },
      ],
      (message) => errors.push(message),
    );
    expect(registered).toEqual(["bbb"]);
    expect(errors[0]).toContain("auth missing");
  });
});
