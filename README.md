# Cloud Artifacts

Cloudflare Worker + R2 service for publishing immutable HTML pages at public, unguessable URLs.

## API

```bash
curl --fail-with-body \
  -X POST \
  -H 'Content-Type: text/html' \
  -H 'X-Artifact-Upload: 1' \
  --data-binary @page.html \
  'https://artifacts.nikitayugov.com/api/artifacts?ttl=86400'
```

`ttl` is optional seconds, from 1 to 31536000. Without it, the artifact does not expire. A successful upload returns `201` with `id`, public `url`, and nullable `expiresAt`. Both `/{uuid}` and `/{uuid}.html` serve the document. Uploads are create-only; there is no update, delete, or list API.

Only complete `text/html` documents are valid. The default size limit is 5 MiB. `Content-Length` and `X-Artifact-Upload: 1` are required. The custom header forces browser preflight, and served pages use a CSP sandbox with an opaque origin, preventing an uploaded page from silently creating more artifacts.

## MCP

Connect a Streamable HTTP MCP client to:

```text
https://artifacts.nikitayugov.com/mcp
```

The server exposes `publish_html` with `html` and optional `ttlSeconds` arguments. It returns the public URL as text and `{ id, url, expiresAt }` as structured content. The MCP endpoint is intentionally unauthenticated, matching the REST upload API.

## IP allowlist

Every HTTP route is checked against `vars.UPLOAD_ALLOWED_IPS` in `wrangler.jsonc` using Cloudflare's `CF-Connecting-IP` value. This includes public artifact reads, the landing page, health, `/SKILL.md`, REST uploads, and MCP.

```jsonc
"UPLOAD_ALLOWED_IPS": ["203.0.113.10", "2001:db8::10"]
```

Only exact IPv4 and IPv6 addresses are accepted; CIDR ranges are not expanded. A `"*"` entry disables enforcement and should not be used when the service must be private.

## Development and deployment

```bash
npm install
npm run types
npm run check
npx wrangler whoami
npx wrangler r2 bucket create cloud-artifacts
npm run deploy
```

The Worker runs hourly cleanup. Expiration is also enforced on every artifact read. Because the service has no identity-based authentication, keep the IP list narrow and consider a Cloudflare WAF rate-limit rule.
