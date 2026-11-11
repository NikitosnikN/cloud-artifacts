// Named docs: permanent links with version history.
//
// Every version is an ordinary immutable artifact (artifacts/{uuid}.html), exactly as
// anonymous uploads are stored. A named doc adds one small JSON "card" per name
// (docs/{name}.json) that lists its versions and says which one is current.
// Publishing appends a version and moves `current`; rollback only moves `current`.
// Nothing is ever copied or deleted, and cleanup never touches docs (versions have no TTL).

import type { Publisher } from "./auth";
import { DOC_PREFIX, docKey } from "./constants";
import { ArtifactValidationError, publishArtifact } from "./upload";

export const DOC_NAME_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/;
export const DOC_NAME_RULE = "Doc name must be 1-64 characters of a-z, 0-9 and dashes, without a leading or trailing dash";

const MAX_TITLE_LENGTH = 200;
const MAX_NOTE_LENGTH = 200;
const MAX_WRITE_ATTEMPTS = 5;
const MAX_ENCODED_TITLE_LENGTH = 1500;

export type DocVersion = {
  version: number;
  /** Artifact UUID holding this version's HTML. */
  id: string;
  author: string;
  createdAt: string;
  bytes: number;
  note?: string;
};

export type DocCard = {
  name: string;
  title: string;
  current: number;
  createdAt: string;
  updatedAt: string;
  updatedBy: string;
  versions: DocVersion[];
};

export type DocSummary = Pick<DocCard, "name" | "title" | "current" | "updatedAt" | "updatedBy">;

export type PublishedDoc = {
  name: string;
  title: string;
  version: number;
  url: string;
  versionUrl: string;
  historyUrl: string;
};

export class DocError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "DocError";
    this.status = status;
  }
}

export function isDocName(name: string): boolean {
  return DOC_NAME_PATTERN.test(name);
}

export function docUrl(env: Env, name: string, version?: number): string {
  const base = `${env.PUBLIC_BASE_URL.replace(/\/$/, "")}/d/${name}`;
  return version === undefined ? base : `${base}/v/${version}`;
}

export function docResponse(env: Env, card: DocCard): PublishedDoc {
  return {
    name: card.name,
    title: card.title,
    version: card.current,
    url: docUrl(env, card.name),
    versionUrl: docUrl(env, card.name, card.current),
    historyUrl: `${docUrl(env, card.name)}/history`,
  };
}

export async function readDoc(env: Env, name: string): Promise<{ card: DocCard; etag: string } | null> {
  const object = await env.ARTIFACTS.get(docKey(name));
  if (!object) return null;
  return { card: await object.json<DocCard>(), etag: object.etag };
}

/** Stores the HTML as a new immutable artifact and makes it the doc's current version. */
export async function publishDocVersion(
  env: Env,
  name: string,
  data: ArrayBuffer | Uint8Array,
  publisher: Publisher,
  note?: string | null,
): Promise<DocCard> {
  if (!isDocName(name)) throw new DocError(DOC_NAME_RULE, 400);
  const cleanNote = normalizeText(note, MAX_NOTE_LENGTH);
  const artifact = await publishArtifact(data, null, env, { maxBytes: publisher.maxBytes, author: publisher.user });
  const title = extractTitle(new TextDecoder().decode(data));
  const at = new Date().toISOString();

  const card = await updateCard(env, name, (existing) => {
    const base: DocCard = existing ?? {
      name,
      title: name,
      current: 0,
      createdAt: at,
      updatedAt: at,
      updatedBy: publisher.user,
      versions: [],
    };
    const version = base.versions.reduce((max, entry) => Math.max(max, entry.version), 0) + 1;
    const entry: DocVersion = {
      version,
      id: artifact.id,
      author: publisher.user,
      createdAt: at,
      bytes: data.byteLength,
      ...(cleanNote ? { note: cleanNote } : {}),
    };
    return {
      ...base,
      title: title ?? base.title,
      current: version,
      updatedAt: at,
      updatedBy: publisher.user,
      versions: [...base.versions, entry],
    };
  });
  console.log(JSON.stringify({ event: "doc_published", name, version: card.current, id: artifact.id, author: publisher.user }));
  return card;
}

/** Makes an existing version current again. Versions are never removed. */
export async function rollbackDoc(env: Env, name: string, to: number, publisher: Publisher): Promise<DocCard> {
  if (!isDocName(name)) throw new DocError("Doc not found", 404);
  const card = await updateCard(env, name, (existing) => {
    if (!existing) throw new DocError("Doc not found", 404);
    if (!existing.versions.some((entry) => entry.version === to)) {
      throw new DocError(`Version ${to} does not exist`, 404);
    }
    return { ...existing, current: to, updatedAt: new Date().toISOString(), updatedBy: publisher.user };
  });
  console.log(JSON.stringify({ event: "doc_rolled_back", name, version: to, author: publisher.user }));
  return card;
}

/** All docs, most recently updated first. Reads only the listing, not each card. */
export async function listDocs(env: Env): Promise<DocSummary[]> {
  const docs: DocSummary[] = [];
  let cursor: string | undefined;
  do {
    const page = await env.ARTIFACTS.list({ prefix: DOC_PREFIX, cursor, limit: 1000, include: ["customMetadata"] });
    for (const object of page.objects) {
      if (!object.key.endsWith(".json")) continue;
      const name = object.key.slice(DOC_PREFIX.length, -".json".length);
      if (!isDocName(name)) continue;
      const meta = object.customMetadata ?? {};
      docs.push({
        name,
        title: decodeTitle(meta.title) || name,
        current: Number(meta.current) || 0,
        updatedAt: meta.updatedAt || object.uploaded.toISOString(),
        updatedBy: meta.updatedBy || "",
      });
    }
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);
  return docs.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

/**
 * Read-modify-write of a card with optimistic locking: the write only succeeds if the card
 * has not changed since it was read, so two people publishing at once both get a version.
 * The very first write of a new name is unconditional; two simultaneous first publishes of
 * the same brand-new name could keep only one of them (the other artifact still exists).
 */
async function updateCard(
  env: Env,
  name: string,
  change: (existing: DocCard | null) => DocCard,
): Promise<DocCard> {
  for (let attempt = 0; attempt < MAX_WRITE_ATTEMPTS; attempt++) {
    // Short random backoff after a conflict, so simultaneous publishers stop colliding.
    if (attempt > 0) await new Promise((resolve) => setTimeout(resolve, 10 + Math.random() * 40 * attempt));
    const existing = await readDoc(env, name);
    const card = change(existing?.card ?? null);
    const body = JSON.stringify(card);
    const options: R2PutOptions = {
      httpMetadata: { contentType: "application/json; charset=utf-8" },
      customMetadata: summaryMetadata(card),
    };
    const saved = existing
      ? await env.ARTIFACTS.put(docKey(name), body, { ...options, onlyIf: { etagMatches: existing.etag } })
      : await env.ARTIFACTS.put(docKey(name), body, options);
    if (saved) return card;
  }
  throw new DocError("The doc was changed by someone else at the same moment; retry", 409);
}

/**
 * Listing metadata, so the catalog needs one list call instead of reading every card.
 * The title is percent-encoded so non-Latin titles stay within R2's metadata rules and
 * its 2 KiB size limit.
 */
function summaryMetadata(card: DocCard): Record<string, string> {
  let title = card.title;
  while (encodeURIComponent(title).length > MAX_ENCODED_TITLE_LENGTH) title = [...title].slice(0, -1).join("");
  return {
    title: encodeURIComponent(title),
    current: String(card.current),
    updatedAt: card.updatedAt,
    updatedBy: card.updatedBy,
  };
}

function decodeTitle(value: string | undefined): string | null {
  if (!value) return null;
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

export function extractTitle(html: string): string | null {
  const match = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  return match ? normalizeText(decodeEntities(match[1]), MAX_TITLE_LENGTH) : null;
}

function normalizeText(value: string | null | undefined, maxLength: number): string | null {
  const text = value?.replace(/\s+/g, " ").trim().slice(0, maxLength);
  return text ? text : null;
}

function decodeEntities(value: string): string {
  return value.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi, (entity, code: string) => {
    const lower = code.toLowerCase();
    if (lower.startsWith("#x")) return safeCodePoint(parseInt(lower.slice(2), 16), entity);
    if (lower.startsWith("#")) return safeCodePoint(parseInt(lower.slice(1), 10), entity);
    return { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " }[lower] ?? entity;
  });
}

function safeCodePoint(code: number, fallback: string): string {
  return Number.isInteger(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : fallback;
}

export function isKnownError(error: unknown): error is DocError | ArtifactValidationError {
  return error instanceof DocError || error instanceof ArtifactValidationError;
}
