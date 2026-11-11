export const PAGE_CSP = "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";

export function json<T>(body: T, status = 200, headers?: HeadersInit): Response {
  const resultHeaders = new Headers(headers);
  resultHeaders.set("content-type", "application/json; charset=utf-8");
  resultHeaders.set("cache-control", "no-store");
  resultHeaders.set("x-content-type-options", "nosniff");
  return Response.json(body, { status, headers: resultHeaders });
}

export function methodNotAllowed(allow: string): Response {
  return json({ error: "Method not allowed" }, 405, { allow });
}

/**
 * Headers for user-uploaded HTML.
 * "immutable" is for content that never changes at its URL (UUID links, pinned doc versions).
 * "revalidate" is for permanent doc links, whose content changes when a new version is published.
 */
export function artifactHeaders(
  etag: string,
  expiresAt: number | null,
  cache: "immutable" | "revalidate" = "immutable",
): Headers {
  return new Headers({
    "cache-control": artifactCacheControl(expiresAt, cache),
    "content-security-policy": "sandbox allow-scripts allow-forms allow-modals allow-popups allow-popups-to-escape-sandbox allow-downloads",
    "content-type": "text/html; charset=utf-8",
    etag,
    "referrer-policy": "no-referrer",
    "x-content-type-options": "nosniff",
  });
}

function artifactCacheControl(expiresAt: number | null, cache: "immutable" | "revalidate"): string {
  if (expiresAt !== null) return "no-store";
  return cache === "revalidate" ? "no-cache" : "public, max-age=31536000, immutable";
}

/** Service-rendered pages (catalog, history): no scripts, fresh on every load. */
export function htmlPage(html: string, method: "GET" | "HEAD", status = 200): Response {
  return new Response(method === "HEAD" ? null : html, {
    status,
    headers: {
      "cache-control": "no-cache",
      "content-security-policy": PAGE_CSP,
      "content-type": "text/html; charset=utf-8",
      "referrer-policy": "no-referrer",
      "x-content-type-options": "nosniff",
    },
  });
}

export function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
