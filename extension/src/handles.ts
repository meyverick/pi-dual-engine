import type { EngineId } from "./types.ts";

export type HandleTarget =
  | { readonly engine: EngineId; readonly handle: string }
  | { readonly error: string };

const CAVEMAN_HANDLE = /^ccr_[A-Za-z0-9_]+$/;
const HEADROOM_HANDLE = /^[a-f0-9]{12,24}$/;
const CAVEMAN_MARKER = /^<<ccr:(.+)>>$/;
const CCR_SCHEME = /^ccr:\/\//;

/** Peel the wrappers an engine may leave around a handle, without deciding the engine. */
export function normalizeHandle(raw: string): string {
  let value = raw.trim();
  const marker = CAVEMAN_MARKER.exec(value);
  if (marker?.[1]) value = marker[1].trim();
  return value.replace(CCR_SCHEME, "");
}

/**
 * Decide which engine owns a recovery handle by its shape alone. Never guesses and never
 * tries one engine then the other: an unrecognized shape is an explicit error.
 */
export function dispatchHandle(raw: string): HandleTarget {
  const handle = normalizeHandle(raw);
  if (CAVEMAN_HANDLE.test(handle)) return { engine: "caveman", handle };
  if (HEADROOM_HANDLE.test(handle)) return { engine: "headroom", handle };
  return {
    error: `Unrecognized recovery handle: "${handle}". Expected a Caveman handle (ccr_...) or a Headroom handle (12-24 lowercase hex).`,
  };
}
