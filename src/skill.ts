import skillMarkdown from "../skill/share-artifact/SKILL.md";

const HEADERS = {
  "access-control-allow-origin": "*",
  "cache-control": "public, max-age=300",
  "content-type": "text/markdown; charset=utf-8",
  "x-content-type-options": "nosniff",
} satisfies HeadersInit;

export function skillDocument(method: "GET" | "HEAD"): Response {
  return new Response(method === "HEAD" ? null : skillMarkdown, { headers: HEADERS });
}
