/**
 * Headless smoke test: start pi with the built extension in a scratch directory, send one prompt
 * through a stub OpenAI-compatible provider, and assert the request declares exactly one retrieval
 * tool. Exit code 0 means the extension loaded and its loadout took effect.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const BUILT = join(import.meta.dir, "..", "dist", "index.js");
const dir = mkdtempSync(join(tmpdir(), "dual-engine-smoke-"));
const agentDir = join(dir, "agent");
mkdirSync(agentDir, { recursive: true });

const bodies: Record<string, unknown>[] = [];
const server = Bun.serve({
  port: 0,
  hostname: "127.0.0.1",
  async fetch(request) {
    if (!request.url.includes("/chat/completions")) return new Response("not found", { status: 404 });
    const body = (await request.json()) as Record<string, unknown>;
    bodies.push(body);
    const model = String(body.model ?? "stub-model");
    const chunk = (delta: Record<string, unknown>, finish: string | null) =>
      `data: ${JSON.stringify({
        id: "chatcmpl-smoke",
        object: "chat.completion.chunk",
        created: 1,
        model,
        choices: [{ index: 0, delta, finish_reason: finish }],
      })}\n\n`;
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        const encoder = new TextEncoder();
        controller.enqueue(encoder.encode(chunk({ role: "assistant", content: "ok" }, null)));
        controller.enqueue(encoder.encode(chunk({}, "stop")));
        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
        controller.close();
      },
    });
    return new Response(stream, { headers: { "content-type": "text/event-stream" } });
  },
});

function writeModels(port: number): void {
  writeFileSync(
    join(agentDir, "models.json"),
    JSON.stringify({
      providers: {
        stub: {
          baseUrl: `http://127.0.0.1:${port}/v1`,
          api: "openai-completions",
          apiKey: "stub-key",
          models: [
            {
              id: "stub-model",
              name: "Stub Model",
              input: ["text"],
              reasoning: false,
              cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
              contextWindow: 8000,
              maxTokens: 512,
            },
          ],
        },
      },
    }),
    "utf8",
  );
}

function toolNames(body: Record<string, unknown> | undefined): string[] {
  const tools = (body?.tools ?? []) as { function?: { name?: string }; name?: string }[];
  return tools.map((tool) => tool.function?.name ?? tool.name ?? "?");
}

async function main(): Promise<number> {
  writeModels(server.port);
  const proc = Bun.spawn({
    cmd: [
      "pi",
      "--print",
      "say hi",
      "--provider",
      "stub",
      "--model",
      "stub-model",
      "--extension",
      BUILT,
      "--no-session",
      "--no-mcp",
      "--no-skills",
      "--no-context-files",
      "--approve",
    ],
    cwd: dir,
    env: { ...process.env, PI_CODING_AGENT_DIR: agentDir, DUAL_ENGINE_HOME: join(dir, "state") },
    stdout: "pipe",
    stderr: "pipe",
  });
  const timer = setTimeout(() => proc.kill(), 120_000);
  const [stdout, stderr] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()]);
  clearTimeout(timer);
  const code = await proc.exited;
  if (code !== 0) {
    console.error(`smoke: pi exited ${code}\n${stderr.slice(-1500)}`);
    return 1;
  }
  if (bodies.length !== 1) {
    console.error(`smoke: expected one provider request, saw ${bodies.length}`);
    return 1;
  }
  const names = toolNames(bodies[0]);
  const retrieval = names.filter((name) => name.toLowerCase().includes("retrieve"));
  if (retrieval.length !== 1 || retrieval[0] !== "retrieve") {
    console.error(`smoke: expected exactly one retrieval tool named retrieve, saw ${JSON.stringify(retrieval)}`);
    return 1;
  }
  console.log(`smoke: ok (${names.length} tools, retrieval=${retrieval[0]}, output=${stdout.trim().slice(0, 40)})`);
  return 0;
}

try {
  const code = await main();
  process.exitCode = code;
} finally {
  server.stop(true);
  rmSync(dir, { recursive: true, force: true });
}
