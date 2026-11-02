import { afterAll, describe, expect, test } from "bun:test";
import { createServer, type Server } from "node:http";
import { retrieveFromHeadroom } from "../src/headroom-http.ts";

const servers: Server[] = [];

afterAll(() => {
  for (const server of servers) server.close();
});

type Stub = { readonly port: number; readonly server: Server };

/** A stub proxy that answers `/v1/retrieve` with the given status and body. */
function listen(status: number, body: unknown, delayMs = 0): Promise<Stub> {
  return new Promise((resolve) => {
    const server = createServer((request, response) => {
      request.resume();
      request.on("end", () => {
        const send = () => {
          response.writeHead(status, { "content-type": "application/json" });
          response.end(JSON.stringify(body));
        };
        if (delayMs > 0) setTimeout(send, delayMs);
        else send();
      });
    });
    servers.push(server);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      resolve({ server, port: typeof address === "object" && address ? address.port : 0 });
    });
  });
}

/** A port that refuses connections: bound, then closed before use. */
async function deadPort(): Promise<number> {
  const stub = await listen(200, {});
  servers.splice(servers.indexOf(stub.server), 1);
  await new Promise<void>((resolve) => stub.server.close(() => resolve()));
  return stub.port;
}

describe("Headroom retrieval over HTTP", () => {
  test("a present handle returns the original bytes unchanged", async () => {
    const payload = "z".repeat(120_000);
    const { port } = await listen(200, { hash: "0aa4e9800c25", original_content: payload });
    const outcome = await retrieveFromHeadroom([port], "0aa4e9800c25");
    expect(outcome.isError).toBe(false);
    expect(outcome.content).toHaveLength(1);
    expect(outcome.content[0]).toEqual({ type: "text", text: payload });
  });

  test("an expired handle reports the store's own reason and is an error", async () => {
    const { port } = await listen(404, { detail: "Entry not found (CCR TTL: 1800 seconds)" });
    const outcome = await retrieveFromHeadroom([port], "0aa4e9800c25");
    expect(outcome.isError).toBe(true);
    expect(outcome.content[0]).toMatchObject({
      type: "text",
      text: expect.stringContaining("Entry not found (CCR TTL: 1800 seconds)"),
    });
  });

  test("the same 404 is not retried on another instance", async () => {
    const first = await listen(404, { detail: "Entry not found" });
    const second = await listen(200, { original_content: "should not be reached" });
    let secondHit = false;
    second.server.on("request", () => {
      secondHit = true;
    });
    const outcome = await retrieveFromHeadroom([first.port, second.port], "0aa4e9800c25");
    expect(outcome.isError).toBe(true);
    expect(secondHit).toBe(false);
  });

  test("a dead instance falls through to the next live one", async () => {
    const dead = await deadPort();
    const { port } = await listen(200, { original_content: "recovered" });
    const outcome = await retrieveFromHeadroom([dead, port], "0aa4e9800c25");
    expect(outcome.isError).toBe(false);
    expect(outcome.content[0]).toEqual({ type: "text", text: "recovered" });
  });

  test("no running instance fails loudly without a request", async () => {
    const outcome = await retrieveFromHeadroom([], "0aa4e9800c25");
    expect(outcome.isError).toBe(true);
    expect(outcome.content[0]).toMatchObject({
      type: "text",
      text: expect.stringContaining("No Headroom instance is running this session"),
    });
  });

  test("a hung instance is bounded by the timeout", async () => {
    const { port } = await listen(200, { original_content: "too late" }, 5_000);
    const started = Date.now();
    const outcome = await retrieveFromHeadroom([port], "0aa4e9800c25", 100);
    expect(outcome.isError).toBe(true);
    expect(Date.now() - started).toBeLessThan(2_000);
  });
});
