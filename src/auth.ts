import { json } from "./http";
import { parsePositiveInteger } from "./parsing";

/** A person holding a personal publish token. */
export type Publisher = { user: string; maxBytes: number };

const TOKEN_HASH = /^[0-9a-f]{64}$/;
const USER_NAME = /^[A-Za-z0-9._-]{1,64}$/;
const BEARER = /^Bearer\s+([\x21-\x7e]+)$/i;

/**
 * Resolves the optional `Authorization: Bearer <token>` header.
 * Returns null for anonymous requests, the publisher for a known token,
 * and a 401 response for a malformed, unknown or revoked token.
 */
export async function identifyPublisher(request: Request, env: Env): Promise<Publisher | null | Response> {
  const header = request.headers.get("authorization")?.trim();
  if (!header) return null;
  const match = BEARER.exec(header);
  if (!match) return unauthorized("Authorization must use the Bearer scheme");
  const publisher = loadPublishers(env).get(await sha256Hex(match[1]));
  return publisher ?? unauthorized("Unknown or revoked publish token");
}

/** Upload size limit: the personal limit for token holders, MAX_HTML_BYTES for everyone else. */
export function uploadLimit(publisher: Publisher | null, env: Env): number {
  return publisher?.maxBytes ?? parsePositiveInteger(env.MAX_HTML_BYTES);
}

export function unauthorized(message: string): Response {
  return json({ error: message }, 401, { "www-authenticate": "Bearer" });
}

export function loadPublishers(env: Env): Map<string, Publisher> {
  const publishers = new Map<string, Publisher>();
  if (!env.PUBLISH_TOKENS) return publishers;

  let parsed: unknown;
  try {
    parsed = JSON.parse(env.PUBLISH_TOKENS);
  } catch {
    throw new Error("PUBLISH_TOKENS must be a JSON object");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("PUBLISH_TOKENS must be a JSON object");
  }

  const defaultLimit = parsePositiveInteger(env.MAX_HTML_BYTES);
  for (const [hash, value] of Object.entries(parsed as Record<string, unknown>)) {
    const entry = value as { user?: unknown; maxBytes?: unknown } | null;
    const label = `PUBLISH_TOKENS entry ${hash.slice(0, 8)}`;
    if (!TOKEN_HASH.test(hash)) throw new Error(`${label}: key must be a lowercase SHA-256 hex digest`);
    if (!entry || typeof entry.user !== "string" || !USER_NAME.test(entry.user)) {
      throw new Error(`${label}: user must be 1-64 characters of A-Z, a-z, 0-9, dot, underscore or dash`);
    }
    const maxBytes = entry.maxBytes ?? defaultLimit;
    if (typeof maxBytes !== "number" || !Number.isSafeInteger(maxBytes) || maxBytes <= 0) {
      throw new Error(`${label}: maxBytes must be a positive integer`);
    }
    publishers.set(hash, { user: entry.user, maxBytes });
  }
  return publishers;
}

export async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
