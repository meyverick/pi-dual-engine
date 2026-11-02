import type { EngineOutcome } from "./retrieve.ts";

/**
 * Headroom keeps one on-disk CCR store per machine (`~/.headroom/ccr_store.db`), so any live local
 * instance can serve any handle. That removes the need for a second, engine-specific retrieval tool
 * and the naming question that comes with it: the coordinator posts the handle to the proxy directly.
 */
const RETRIEVE_TIMEOUT_MS = 2_000;

type HeadroomBody = { readonly original_content?: unknown; readonly detail?: unknown };

function text(value: string): EngineOutcome["content"] {
  return [{ type: "text", text: value }];
}

/**
 * Recover a Headroom handle over its HTTP endpoint. One request per live port, stopping at the
 * first HTTP answer: a 404 is store-wide, so asking another instance cannot change it, and only a
 * transport failure (a dead instance) is worth the next port.
 */
export async function retrieveFromHeadroom(
  ports: readonly number[],
  handle: string,
  timeoutMs = RETRIEVE_TIMEOUT_MS,
): Promise<EngineOutcome> {
  if (ports.length === 0) {
    return {
      content: text(`No Headroom instance is running this session, so ${handle} cannot be recovered.`),
      isError: true,
    };
  }

  let lastError = "no instance answered";
  for (const port of ports) {
    let response: Response;
    try {
      response = await fetch(`http://127.0.0.1:${port}/v1/retrieve`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ hash: handle }),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (error) {
      lastError = `Headroom on port ${port} did not answer: ${(error as Error).message}`;
      continue;
    }

    const body = (await response.json().catch(() => undefined)) as HeadroomBody | undefined;
    if (response.ok && typeof body?.original_content === "string") {
      return { content: text(body.original_content), isError: false };
    }

    const detail = typeof body?.detail === "string" ? body.detail : `HTTP ${response.status}`;
    return { content: text(`Headroom could not recover ${handle}: ${detail}`), isError: true };
  }

  return { content: text(`No Headroom instance answered for ${handle} (${lastError}).`), isError: true };
}
