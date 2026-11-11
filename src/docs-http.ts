import { unauthorized, type Publisher } from "./auth";
import { renderCatalog, renderHistory } from "./catalog";
import { artifactKey } from "./constants";
import {
  DOC_NAME_RULE,
  docResponse,
  docUrl,
  isDocName,
  isKnownError,
  listDocs,
  publishDocVersion,
  readDoc,
  rollbackDoc,
} from "./docs";
import { artifactHeaders, htmlPage, json } from "./http";
import { readHtmlBody } from "./upload";

type ReadMethod = "GET" | "HEAD";

/** PUT /api/docs/{name}: publish a new version under a permanent name. Token required. */
export async function handlePublishDoc(
  request: Request,
  env: Env,
  name: string,
  publisher: Publisher | null,
): Promise<Response> {
  if (!publisher) return unauthorized("A personal publish token is required to publish named docs");
  if (!isDocName(name)) return json({ error: DOC_NAME_RULE }, 400);

  const data = await readHtmlBody(request, publisher.maxBytes, true);
  if (data instanceof Response) return data;

  try {
    const card = await publishDocVersion(env, name, data, publisher, readNote(request));
    return json(docResponse(env, card), 201, { location: docUrl(env, name) });
  } catch (error) {
    if (isKnownError(error)) return json({ error: error.message }, error.status);
    throw error;
  }
}

/** POST /api/docs/{name}/rollback?to={n}: make an older version current. Token required. */
export async function handleRollbackDoc(
  url: URL,
  env: Env,
  name: string,
  publisher: Publisher | null,
): Promise<Response> {
  if (!publisher) return unauthorized("A personal publish token is required to roll back docs");
  const to = url.searchParams.get("to");
  if (!to || !/^[1-9]\d{0,8}$/.test(to)) return json({ error: "to must be a version number" }, 400);

  try {
    const card = await rollbackDoc(env, name, Number(to), publisher);
    return json(docResponse(env, card));
  } catch (error) {
    if (isKnownError(error)) return json({ error: error.message }, error.status);
    throw error;
  }
}

/** GET /api/docs/{name}: the doc's card with all versions. */
export async function handleGetDoc(env: Env, name: string): Promise<Response> {
  const doc = isDocName(name) ? await readDoc(env, name) : null;
  return doc ? json({ ...doc.card, ...docResponse(env, doc.card) }) : json({ error: "Doc not found" }, 404);
}

/** GET /api/docs: every doc, most recently updated first. */
export async function handleListDocs(env: Env): Promise<Response> {
  const docs = await listDocs(env);
  return json({ docs: docs.map((doc) => ({ ...doc, url: docUrl(env, doc.name) })) });
}

/** GET /d/ */
export async function catalogPage(env: Env, method: ReadMethod): Promise<Response> {
  return htmlPage(renderCatalog(await listDocs(env)), method);
}

/** GET /d/{name}/history */
export async function historyPage(env: Env, name: string, method: ReadMethod): Promise<Response> {
  const doc = isDocName(name) ? await readDoc(env, name) : null;
  return doc ? htmlPage(renderHistory(doc.card), method) : json({ error: "Doc not found" }, 404);
}

/**
 * GET /d/{name} serves the current version and must be revalidated on every load.
 * GET /d/{name}/v/{n} serves a fixed version and is cached like any UUID artifact.
 */
export async function serveDoc(
  request: Request,
  env: Env,
  name: string,
  pinnedVersion: number | null,
): Promise<Response> {
  const doc = isDocName(name) ? await readDoc(env, name) : null;
  if (!doc) return json({ error: "Doc not found" }, 404);

  const version = pinnedVersion ?? doc.card.current;
  const entry = doc.card.versions.find((candidate) => candidate.version === version);
  if (!entry) return json({ error: `Version ${version} does not exist` }, 404);

  const cache = pinnedVersion === null ? "revalidate" : "immutable";
  const key = artifactKey(entry.id);

  if (request.method === "HEAD") {
    const object = await env.ARTIFACTS.head(key);
    if (!object) return missingContent(name, entry.id);
    const headers = docHeaders(object.httpEtag, cache, version);
    headers.set("content-length", String(object.size));
    return new Response(null, { headers });
  }

  const object = await env.ARTIFACTS.get(key);
  if (!object) return missingContent(name, entry.id);
  const headers = docHeaders(object.httpEtag, cache, version);
  if (request.headers.get("if-none-match") === object.httpEtag) {
    return new Response(null, { status: 304, headers });
  }
  return new Response(object.body, { headers });
}

function docHeaders(etag: string, cache: "immutable" | "revalidate", version: number): Headers {
  const headers = artifactHeaders(etag, null, cache);
  headers.set("x-doc-version", String(version));
  return headers;
}

function missingContent(name: string, id: string): Response {
  console.error(JSON.stringify({ event: "doc_version_missing", name, id }));
  return json({ error: "Version content is missing" }, 500);
}

/** Optional X-Doc-Note header; percent-encode it to send non-ASCII text. */
function readNote(request: Request): string | null {
  const raw = request.headers.get("x-doc-note");
  if (!raw) return null;
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}
