import { uploadLimit, type Publisher } from "./auth";
import { artifactKey } from "./constants";
import { json } from "./http";
import { parseContentLength, parsePositiveInteger, parseTtl } from "./parsing";

const HTML_DOCUMENT_START = /^\s*(?:<!doctype\s+html(?:\s|>)|<html(?:\s|>))/i;

export type PublishedArtifact = { id: string; url: string; expiresAt: string | null };

export type PublishOptions = {
  /** Size limit for this upload; defaults to MAX_HTML_BYTES. */
  maxBytes?: number;
  /** Token holder who published it; stored as object metadata. */
  author?: string;
};

export class ArtifactValidationError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "ArtifactValidationError";
    this.status = status;
  }
}

export async function uploadArtifact(
  request: Request,
  url: URL,
  env: Env,
  publisher: Publisher | null = null,
): Promise<Response> {
  const ttl = parseTtl(url.searchParams.get("ttl"), parsePositiveInteger(env.MAX_TTL_SECONDS));
  if (ttl instanceof Response) return ttl;

  const maxBytes = uploadLimit(publisher, env);
  const data = await readHtmlBody(request, maxBytes, publisher !== null);
  if (data instanceof Response) return data;

  try {
    const artifact = await publishArtifact(data, ttl, env, { maxBytes, author: publisher?.user });
    return json(artifact, 201, { location: artifact.url });
  } catch (error) {
    if (error instanceof ArtifactValidationError) return json({ error: error.message }, error.status);
    throw error;
  }
}

/** Validates the upload request shape and reads the body. Shared by anonymous uploads and named docs. */
export async function readHtmlBody(
  request: Request,
  maxBytes: number,
  hasToken: boolean,
): Promise<ArrayBuffer | Response> {
  if (request.headers.get("x-artifact-upload") !== "1") {
    return json({ error: "Missing required x-artifact-upload header" }, 400);
  }
  const mediaType = request.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase();
  if (mediaType !== "text/html") return json({ error: "Content-Type must be text/html" }, 415);
  if (request.headers.has("content-encoding")) {
    return json({ error: "Compressed request bodies are not supported" }, 415);
  }

  const contentLength = parseContentLength(request.headers.get("content-length"));
  if (contentLength === null) return json({ error: "Content-Length is required" }, 411);
  if (contentLength > maxBytes) return json({ error: sizeLimitMessage(maxBytes, hasToken) }, 413);

  const data = await request.arrayBuffer();
  if (data.byteLength !== contentLength) {
    return json({ error: "Content-Length does not match the request body" }, 400);
  }
  return data;
}

export function sizeLimitMessage(maxBytes: number, hasToken: boolean): string {
  return hasToken
    ? `HTML document exceeds ${maxBytes} bytes`
    : `HTML document exceeds ${maxBytes} bytes; a personal publish token allows larger pages`;
}

export async function publishArtifact(
  data: ArrayBuffer | Uint8Array,
  ttlSeconds: number | null,
  env: Env,
  options: PublishOptions = {},
): Promise<PublishedArtifact> {
  const maxBytes = options.maxBytes ?? parsePositiveInteger(env.MAX_HTML_BYTES);
  if (data.byteLength === 0) throw new ArtifactValidationError("HTML document must not be empty", 400);
  if (data.byteLength > maxBytes) {
    throw new ArtifactValidationError(sizeLimitMessage(maxBytes, options.author !== undefined), 413);
  }

  let html: string;
  try {
    html = new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(data);
  } catch {
    throw new ArtifactValidationError("Body must be valid UTF-8 HTML", 422);
  }
  if (!HTML_DOCUMENT_START.test(html)) {
    throw new ArtifactValidationError("Body must be a complete HTML document", 422);
  }

  const maxTtl = parsePositiveInteger(env.MAX_TTL_SECONDS);
  if (ttlSeconds !== null && (!Number.isSafeInteger(ttlSeconds) || ttlSeconds <= 0 || ttlSeconds > maxTtl)) {
    throw new ArtifactValidationError(`ttl must be between 1 and ${maxTtl} seconds`, 400);
  }

  const id = crypto.randomUUID();
  const createdAt = new Date();
  const expiresAt = ttlSeconds === null ? null : new Date(createdAt.getTime() + ttlSeconds * 1000);
  const customMetadata: Record<string, string> = { createdAt: createdAt.toISOString() };
  if (expiresAt) customMetadata.expiresAt = expiresAt.toISOString();
  if (options.author) customMetadata.author = options.author;

  const checksum = await crypto.subtle.digest("SHA-256", data);
  await env.ARTIFACTS.put(artifactKey(id), data, {
    httpMetadata: { contentType: "text/html; charset=utf-8" },
    customMetadata,
    sha256: checksum,
  });

  const url = `${env.PUBLIC_BASE_URL.replace(/\/$/, "")}/${id}.html`;
  const artifact = { id, url, expiresAt: expiresAt?.toISOString() ?? null };
  console.log(JSON.stringify({ event: "artifact_created", ...artifact, author: options.author ?? null }));
  return artifact;
}
