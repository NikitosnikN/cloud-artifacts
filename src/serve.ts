import { artifactKey } from "./constants";
import { artifactHeaders, json } from "./http";
import { parseExpiresAt } from "./parsing";

export async function serveArtifact(
  request: Request,
  id: string,
  env: Env,
  ctx: ExecutionContext,
): Promise<Response> {
  const key = artifactKey(id);
  if (request.method === "HEAD") {
    const object = await env.ARTIFACTS.head(key);
    if (!object) return json({ error: "Artifact not found" }, 404);
    const expiryResponse = rejectExpired(object, key, env, ctx);
    if (expiryResponse) return expiryResponse;
    const headers = artifactHeaders(object.httpEtag, parseExpiresAt(object.customMetadata?.expiresAt));
    headers.set("content-length", String(object.size));
    return new Response(null, { headers });
  }

  const object = await env.ARTIFACTS.get(key);
  if (!object) return json({ error: "Artifact not found" }, 404);
  const expiryResponse = rejectExpired(object, key, env, ctx);
  if (expiryResponse) return expiryResponse;
  const headers = artifactHeaders(object.httpEtag, parseExpiresAt(object.customMetadata?.expiresAt));
  if (request.headers.get("if-none-match") === object.httpEtag) {
    return new Response(null, { status: 304, headers });
  }
  return new Response(object.body, { headers });
}

function rejectExpired(object: R2Object, key: string, env: Env, ctx: ExecutionContext): Response | null {
  const expiresAt = parseExpiresAt(object.customMetadata?.expiresAt);
  if (expiresAt === null || expiresAt > Date.now()) return null;
  ctx.waitUntil(env.ARTIFACTS.delete(key));
  return json({ error: "Artifact expired" }, 410);
}
