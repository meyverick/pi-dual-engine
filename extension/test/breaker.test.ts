import { describe, expect, test } from "bun:test";
import type { Api, Model as PiModel } from "@earendil-works/pi-ai";
import { onProviderResponse } from "../src/breaker.ts";

const asModel = (model: Model): PiModel<Api> => model as unknown as PiModel<Api>;

type Model = { provider: string; id: string; baseUrl: string };

function state(direct: Model) {
  const notices: string[] = [];
  return {
    notices,
    values: {
      tripped: new Set<string>(),
      directModels: new Map([[direct.provider, asModel(direct)]]),
      notify: (message: string) => notices.push(message),
    },
  };
}

describe("fail-open breaker", () => {
  test("a proxy failure restores the direct endpoint once and reports once", async () => {
    const direct: Model = { provider: "aaa", id: "aaa-model", baseUrl: "https://a.example.com/v1" };
    const breaker = state(direct);
    const restored: Model[] = [];
    const routed: Model = { ...direct, baseUrl: "http://127.0.0.1:8801" };
    const input = {
      event: { status: 502 },
      model: asModel(routed),
      setModel: async (model: PiModel<Api>) => {
        restored.push(model as Model);
        return true;
      },
    };

    await onProviderResponse(breaker.values, input);
    expect(restored).toEqual([direct]);
    expect(breaker.notices).toHaveLength(1);
    expect(breaker.notices[0]).toContain("502");

    await onProviderResponse(breaker.values, input);
    expect(restored).toHaveLength(1);
    expect(breaker.notices).toHaveLength(1);
  });

  test("a later selection of the same provider does not route again", async () => {
    const direct: Model = { provider: "aaa", id: "aaa-model", baseUrl: "https://a.example.com/v1" };
    const breaker = state(direct);
    breaker.values.tripped.add("aaa");
    let called = 0;
    await onProviderResponse(breaker.values, {
      event: { status: 500 },
      model: asModel({ ...direct, baseUrl: "http://127.0.0.1:8801" }),
      setModel: async () => {
        called += 1;
        return true;
      },
    });
    expect(called).toBe(0);
    expect(breaker.notices).toHaveLength(0);
  });

  test("a success response leaves routing alone", async () => {
    const direct: Model = { provider: "aaa", id: "aaa-model", baseUrl: "https://a.example.com/v1" };
    const breaker = state(direct);
    let called = 0;
    await onProviderResponse(breaker.values, {
      event: { status: 200 },
      model: asModel(direct),
      setModel: async () => {
        called += 1;
        return true;
      },
    });
    expect(called).toBe(0);
  });

  test("a provider with no direct model is left untouched", async () => {
    const direct: Model = { provider: "aaa", id: "aaa-model", baseUrl: "https://a.example.com/v1" };
    const breaker = state(direct);
    let called = 0;
    await onProviderResponse(breaker.values, {
      event: { status: 503 },
      model: asModel({ provider: "other", id: "x", baseUrl: "http://127.0.0.1:1" }),
      setModel: async () => {
        called += 1;
        return true;
      },
    });
    expect(called).toBe(0);
  });
});
