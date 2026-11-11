import { cleanupExpired } from "./cleanup";
import { requireAllowedIp } from "./access";
import { identifyPublisher } from "./auth";
import { DOC_API_PATH, DOC_PAGE_PATH, DOCS_API_PATH, UPLOAD_PATH, UUID_PATH } from "./constants";
import {
  catalogPage,
  handleGetDoc,
  handleListDocs,
  handlePublishDoc,
  handleRollbackDoc,
  historyPage,
  serveDoc,
} from "./docs-http";
import { json, methodNotAllowed } from "./http";
import { landingPage } from "./landing";
import { handleMcp, MCP_PATH } from "./mcp";
import { serveArtifact } from "./serve";
import { skillDocument } from "./skill";
import { uploadArtifact } from "./upload";

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    try {
      return await route(request, env, ctx);
    } catch (error) {
      console.error(JSON.stringify({
        event: "request_failed",
        path: new URL(request.url).pathname,
        error: error instanceof Error ? error.message : String(error),
      }));
      return json({ error: "Internal server error" }, 500);
    }
  },

  scheduled(_controller: ScheduledController, env: Env, ctx: ExecutionContext): void {
    ctx.waitUntil(cleanupExpired(env, Date.now()).then((result) => {
      console.log(JSON.stringify({ event: "ttl_cleanup", ...result }));
    }));
  },
} satisfies ExportedHandler<Env>;

async function route(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  // The IP allowlist still applies to every route; a publish token never bypasses it.
  const denied = requireAllowedIp(request, env.UPLOAD_ALLOWED_IPS);
  if (denied) return denied;

  const url = new URL(request.url);
  const read = isRead(request);
  if (url.pathname === "/") {
    return read ? landingPage(request.method as ReadMethod) : methodNotAllowed("GET, HEAD");
  }
  if (url.pathname === "/SKILL.md") {
    return read ? skillDocument(request.method as ReadMethod) : methodNotAllowed("GET, HEAD");
  }
  if (url.pathname === "/health" && request.method === "GET") return json({ status: "ok" });
  if (url.pathname === MCP_PATH) {
    return handleMcp(request, env, ctx);
  }
  if (url.pathname === UPLOAD_PATH) {
    if (request.method !== "POST") return methodNotAllowed("POST");
    const publisher = await identifyPublisher(request, env);
    if (publisher instanceof Response) return publisher;
    return uploadArtifact(request, url, env, publisher);
  }

  // Named docs: catalog, permanent links, pinned versions, history.
  if (url.pathname === "/d" || url.pathname === "/d/") {
    return read ? catalogPage(env, request.method as ReadMethod) : methodNotAllowed("GET, HEAD");
  }
  const docPage = DOC_PAGE_PATH.exec(url.pathname);
  if (docPage) {
    if (!read) return methodNotAllowed("GET, HEAD");
    const [, name, version, history] = docPage;
    if (history) return historyPage(env, name, request.method as ReadMethod);
    return serveDoc(request, env, name, version ? Number(version) : null);
  }

  // Named docs API.
  if (url.pathname === DOCS_API_PATH) {
    return request.method === "GET" ? handleListDocs(env) : methodNotAllowed("GET");
  }
  const docApi = DOC_API_PATH.exec(url.pathname);
  if (docApi) {
    const [, name, rollback] = docApi;
    if (rollback && request.method !== "POST") return methodNotAllowed("POST");
    if (!rollback && request.method === "GET") return handleGetDoc(env, name);
    if (!rollback && request.method !== "PUT") return methodNotAllowed("GET, PUT");
    const publisher = await identifyPublisher(request, env);
    if (publisher instanceof Response) return publisher;
    return rollback
      ? handleRollbackDoc(url, env, name, publisher)
      : handlePublishDoc(request, env, name, publisher);
  }

  const match = UUID_PATH.exec(url.pathname);
  if (match && read) {
    return serveArtifact(request, match[1], env, ctx);
  }
  return match ? methodNotAllowed("GET, HEAD") : json({ error: "Not found" }, 404);
}

type ReadMethod = "GET" | "HEAD";

function isRead(request: Request): boolean {
  return request.method === "GET" || request.method === "HEAD";
}

export { cleanupExpired } from "./cleanup";
