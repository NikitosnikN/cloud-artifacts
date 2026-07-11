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

export function artifactHeaders(etag: string, expiresAt: number | null): Headers {
  return new Headers({
    "cache-control": expiresAt === null ? "public, max-age=31536000, immutable" : "no-store",
    "content-security-policy": "sandbox allow-scripts allow-forms allow-modals allow-popups allow-popups-to-escape-sandbox allow-downloads",
    "content-type": "text/html; charset=utf-8",
    etag,
    "referrer-policy": "no-referrer",
    "x-content-type-options": "nosniff",
  });
}
