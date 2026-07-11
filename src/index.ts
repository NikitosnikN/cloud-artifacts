import { cleanupExpired } from "./cleanup";
import { requireAllowedUploadIp } from "./access";
import { UPLOAD_PATH, UUID_PATH } from "./constants";
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
  const url = new URL(request.url);
  if (url.pathname === "/") {
    return request.method === "GET" || request.method === "HEAD"
      ? landingPage(request.method)
      : methodNotAllowed("GET, HEAD");
  }
  if (url.pathname === "/SKILL.md") {
    return request.method === "GET" || request.method === "HEAD"
      ? skillDocument(request.method)
      : methodNotAllowed("GET, HEAD");
  }
  if (url.pathname === "/health" && request.method === "GET") return json({ status: "ok" });
  if (url.pathname === MCP_PATH) {
    return requireAllowedUploadIp(request, env.UPLOAD_ALLOWED_IPS) ?? handleMcp(request, env, ctx);
  }
  if (url.pathname === UPLOAD_PATH) {
    if (request.method !== "POST") return methodNotAllowed("POST");
    return requireAllowedUploadIp(request, env.UPLOAD_ALLOWED_IPS) ?? uploadArtifact(request, url, env);
  }
  const match = UUID_PATH.exec(url.pathname);
  if (match && (request.method === "GET" || request.method === "HEAD")) {
    return serveArtifact(request, match[1], env, ctx);
  }
  return match ? methodNotAllowed("GET, HEAD") : json({ error: "Not found" }, 404);
}

export { cleanupExpired } from "./cleanup";
