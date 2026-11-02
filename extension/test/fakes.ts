import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

export type ChatModel = {
  readonly provider: string;
  readonly id: string;
  readonly name: string;
  readonly api: string;
  readonly baseUrl?: string;
  readonly reasoning: boolean;
  readonly input: readonly ("text" | "image")[];
  readonly cost: { input: number; output: number; cacheRead: number; cacheWrite: number };
  readonly contextWindow: number;
  readonly maxTokens: number;
};

export function chatModel(provider: string, api: string, host: string, id = `${provider}-model`): ChatModel {
  return {
    provider,
    id,
    name: id,
    api,
    baseUrl: `https://${host}/v1`,
    reasoning: false,
    input: ["text"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 1000,
    maxTokens: 100,
  };
}

export type FakePi = {
  api: ExtensionAPI;
  tools: { name: string; definition: Record<string, unknown> }[];
  providers: { name: string; config: Record<string, unknown> }[];
  mcp: { name: string; config: Record<string, unknown> }[];
  commands: { name: string; handler: (args: string, ctx: FakeCtx) => Promise<void> }[];
  handlers: Map<string, ((event: unknown, ctx: FakeCtx) => Promise<void>)[]>;
  models: ChatModel[];
  notices: { type: string; message: string }[];
  setModelCalls: ChatModel[];
  emit(event: string, payload: unknown, ctx?: FakeCtx): Promise<void>;
  ctx: FakeCtx;
};

export type FakeCtx = {
  ui: { notify(message: string, type?: "info" | "warning" | "error"): void };
  model: ChatModel | undefined;
  setModel(model: ChatModel): Promise<boolean>;
  modelRegistry: {
    getModelsOfType(type: "chat"): readonly ChatModel[];
    getAvailableOfType(type: "chat"): Promise<readonly ChatModel[]>;
  };
  executeTool(
    name: string,
    args: unknown,
  ): Promise<{ result: { content: { type: "text"; text: string }[] }; isError: boolean }>;
  calls: { name: string; args: unknown }[];
};

type Extras = Partial<Record<"image" | "classifier", readonly ChatModel[]>>;

export function makeCtx(models: readonly ChatModel[], current?: ChatModel, extras: Extras = {}): FakeCtx {
  const calls: { name: string; args: unknown }[] = [];
  const ctx: FakeCtx = {
    ui: { notify: () => {} },
    model: current ?? models[0],
    calls,
    setModel: async (model) => {
      ctx.model = model;
      return true;
    },
    modelRegistry: {
      getModelsOfType: (type: string) =>
        type === "chat" ? models : (extras[type as "image" | "classifier"] ?? []),
      getAvailableOfType: async () => models,
    },
    executeTool: async (name, args) => {
      calls.push({ name, args });
      return {
        result: { content: [{ type: "text", text: `${name}:${JSON.stringify(args)}` }] },
        isError: false,
      };
    },
  };
  return ctx;
}

export function makePi(
  models: readonly ChatModel[],
  options: { exposure?: boolean; extras?: Extras } = {},
): FakePi {
  const tools: FakePi["tools"] = [];
  const providers: FakePi["providers"] = [];
  const mcp: FakePi["mcp"] = [];
  const commands: FakePi["commands"] = [];
  const handlers = new Map<string, ((event: unknown, ctx: FakeCtx) => Promise<void>)[]>();
  const notices: { type: string; message: string }[] = [];
  const setModelCalls: ChatModel[] = [];
  const ctx = makeCtx(models, undefined, options.extras);
  ctx.ui.notify = (message, type = "info") => {
    notices.push({ type, message });
  };
  ctx.setModel = async (model) => {
    setModelCalls.push(model);
    ctx.model = model;
    return true;
  };

  const api = {
    registerTool: (definition: { name: string } & Record<string, unknown>) => {
      tools.push({ name: definition.name, definition });
    },
    registerProvider: (name: string, config: Record<string, unknown>) => {
      providers.push({ name, config });
    },
    registerMcpServer: (name: string, config: Record<string, unknown>) => {
      mcp.push({ name, config });
    },
    registerCommand: (name: string, options: { handler: FakePi["commands"][number]["handler"] }) => {
      commands.push({ name, handler: options.handler });
    },
    on: (event: string, handler: (event: unknown, ctx: FakeCtx) => Promise<void>) => {
      handlers.set(event, [...(handlers.get(event) ?? []), handler]);
      return () => {};
    },
    getAllTools: () =>
      options.exposure === false
        ? [{ name: "caveman_retrieve" }]
        : [{ name: "caveman_retrieve", exposure: "direct" }],
    getActiveTools: () => ["caveman_retrieve"],
    setModel: async (model: ChatModel) => {
      setModelCalls.push(model);
      return true;
    },
  } as unknown as ExtensionAPI;

  const fake: FakePi = {
    api,
    tools,
    providers,
    mcp,
    commands,
    handlers,
    models: [...models],
    notices,
    setModelCalls,
    ctx,
    async emit(event, payload, target) {
      for (const handler of handlers.get(event) ?? []) await handler(payload, target ?? ctx);
    },
  };
  return fake;
}

export type { ExtensionContext };
