---
name: share-cloud-artifact
description: Publish a complete HTML document to Cloud Artifacts and return its public URL. Use when an agent needs to share an HTML report, prototype, visualization, dashboard, or other self-contained web page with another person, optionally with an expiry time.
---

# Share Cloud Artifact

Publish only complete HTML documents. Do not upload Markdown, JSON, images, or HTML fragments.

## Publish

Prefer the `publish_html` tool when the Cloud Artifacts MCP server is connected at `https://artifacts.nikitayugov.com/mcp`. Pass the complete document as `html` and optional expiry as `ttlSeconds`, then return the public URL.

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
