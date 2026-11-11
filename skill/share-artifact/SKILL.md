---
name: share-artifact
description: Publish a complete HTML document to artifacts and return its public URL. Use when an agent needs to share an HTML report, prototype, visualization, dashboard, or other self-contained web page with another person, optionally with an expiry time.
---

# Share Artifact

Publish only complete HTML documents. Do not upload Markdown, JSON, images, or HTML fragments.

## Publish

Prefer the `publish_html` tool when the artifacts MCP server is connected at `https://artifacts.nikitayugov.com/mcp`. Pass the complete document as `html` and optional expiry as `ttlSeconds`, then return the public URL.

When the MCP tool is unavailable, use HTTP:

1. Write the final HTML to a temporary `.html` file.
2. Choose no TTL for a permanent artifact, or a positive TTL in seconds up to one year.
3. Upload with this exact request shape:

```bash
curl --fail-with-body \
  -X POST \
  -H 'Content-Type: text/html' \
  -H 'X-Artifact-Upload: 1' \
  --data-binary @/absolute/path/to/page.html \
  'https://artifacts.nikitayugov.com/api/artifacts?ttl=86400'
```

Omit `?ttl=86400` when the artifact should not expire. Preserve `--data-binary`; form or JSON encoding is invalid.

4. Parse the JSON response and return its `url` field to the user. Mention `expiresAt` when it is non-null.

Do not invent a URL when the upload fails. Report the HTTP error body and keep the source HTML so the request can be retried.

## Publish a named doc (permanent link)

Use this when the page will be updated later and its link must not change. It needs a personal publish token; read it from the location the user gives and never print it.

```bash
curl --fail-with-body \
  -X PUT \
  -H "Authorization: Bearer $ARTIFACTS_TOKEN" \
  -H 'Content-Type: text/html' \
  -H 'X-Artifact-Upload: 1' \
  -H 'X-Doc-Note: short%20change%20note' \
  --data-binary @/absolute/path/to/page.html \
  'https://artifacts.nikitayugov.com/api/docs/tron-energy-atlas'
```

- The name is permanent: 1-64 characters of `a-z`, `0-9` and dashes. Reuse the same name for every update.
- Return the `url` field (`/d/{name}`). It always opens the latest version. `versionUrl` pins this exact version.
- `X-Doc-Note` is optional; percent-encode non-ASCII text.
- Named docs never expire. The page title comes from the document's `<title>`.
- With the MCP tool, pass `name` (and optional `note`) to `publish_html`; the MCP client must send the same `Authorization` header.
- Roll back with `POST /api/docs/{name}/rollback?to=3` and the same token.
- The catalog of all docs is at `/d/`; one doc's versions are at `/d/{name}/history`.

A personal token also raises the size limit for ordinary uploads: send the same `Authorization` header to `POST /api/artifacts`.
