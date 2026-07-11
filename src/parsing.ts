import { json } from "./http";

export function parseTtl(value: string | null, max: number): number | null | Response {
  if (value === null) return null;
  if (!/^[1-9]\d*$/.test(value)) return json({ error: "ttl must be a positive integer in seconds" }, 400);
  const ttl = Number(value);
  return Number.isSafeInteger(ttl) && ttl <= max
    ? ttl
    : json({ error: `ttl must not exceed ${max} seconds` }, 400);
}

export function parseContentLength(value: string | null): number | null {
  if (value === null || !/^\d+$/.test(value)) return null;
  const length = Number(value);
  return Number.isSafeInteger(length) ? length : null;
}

export function parsePositiveInteger(value: string): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`Invalid positive integer configuration: ${value}`);
  }
  return parsed;
}

export function parseExpiresAt(value: string | undefined): number | null {
  if (!value) return null;
  const timestamp = Date.parse(value);
  return Number.isNaN(timestamp) ? null : timestamp;
}
