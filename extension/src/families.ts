import type { EngineId, Family } from "./types.ts";

/** Tokens that identify a wire family from pi's model `api` value. Order matters: first match wins. */
const FAMILY_TOKENS: readonly (readonly [string, Family])[] = [
  ["anthropic", "anthropic"],
  ["google", "gemini"],
  ["gemini", "gemini"],
  ["openai", "openai"],
];

/**
 * The wire family a model `api` belongs to, or undefined when no engine has a wire layer for it.
 * Images, classifiers and unknown APIs never route.
 */
export function familyOf(api: string): Family | undefined {
  const value = api.toLowerCase();
  for (const [token, family] of FAMILY_TOKENS) {
    if (value.includes(token)) return family;
  }
  return undefined;
}

/** The host of a base URL, or "" when it does not parse. Routing compares hosts, never paths. */
export function hostOf(baseUrl: string | undefined): string {
  if (!baseUrl) return "";
  try {
    return new URL(baseUrl).host;
  } catch {
    return "";
  }
}

/**
 * Caveman publishes upstreams under its own keys. A key names a wire family; an
 * OpenAI-compatible compat mount is always the openai family.
 */
export function cavemanFamilyOf(key: string, compat: boolean): Family | undefined {
  return compat ? "openai" : familyOf(key);
}

/** Engine retrieval tools that the coordinator hides while keeping them callable. */
export const RETRIEVAL_TOOLS: Record<EngineId, string> = {
  caveman: "caveman_retrieve",
  headroom: "mcp__headroom__headroom_retrieve",
};
