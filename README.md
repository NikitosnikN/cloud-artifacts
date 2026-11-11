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

`ttl` is optional seconds, from 1 to 31536000. Without it, the artifact does not expire. A successful upload returns `201` with `id`, public `url`, and nullable `expiresAt`. Both `/{uuid}` and `/{uuid}.html` serve the document. UUID uploads are create-only; there is no update or delete API for them. For a link that stays the same across updates, use a named doc (below).

Only complete `text/html` documents are valid. The default size limit is 5 MiB. `Content-Length` and `X-Artifact-Upload: 1` are required. The custom header forces browser preflight, and served pages use a CSP sandbox with an opaque origin, preventing an uploaded page from silently creating more artifacts.

## Named docs (permanent links)

A named doc keeps one link while its content changes. Each version is an ordinary immutable artifact; a small JSON card at `docs/{name}.json` in the same R2 bucket lists the versions and marks the current one.

| Route | Auth | Purpose |
|---|---|---|
| `PUT /api/docs/{name}` | Personal token | Publish a new version (same body and headers as `POST /api/artifacts`, plus optional `X-Doc-Note`) |
| `POST /api/docs/{name}/rollback?to={n}` | Personal token | Make an existing version current again |
| `GET /api/docs`, `GET /api/docs/{name}` | — | JSON list of docs, or one doc with all versions |
| `GET /d/` | — | Catalog page of all docs |
| `GET /d/{name}` | — | Current version, `cache-control: no-cache` so readers always see the latest |
| `GET /d/{name}/v/{n}` | — | Fixed version, cached as immutable |
| `GET /d/{name}/history` | — | Version history page |

```bash
curl --fail-with-body -X PUT \
  -H "Authorization: Bearer $ARTIFACTS_TOKEN" \
  -H 'Content-Type: text/html' -H 'X-Artifact-Upload: 1' \
  --data-binary @page.html \
  'https://artifacts.nikitayugov.com/api/docs/tron-energy-atlas'
```

Names are 1-64 characters of `a-z`, `0-9` and dashes. Named docs never expire, rollback only moves the pointer, and nothing is deleted. Concurrent publishes are serialised with R2 conditional writes, so each one gets its own version. Old UUID links are unchanged.

## Personal publish tokens

Uploads without a token work as before, with the `MAX_HTML_BYTES` limit. A personal token identifies the publisher, is required for named docs, and can carry a larger per-person size limit. The IP allowlist still applies to token holders.

Tokens live in the `PUBLISH_TOKENS` secret as JSON keyed by each token's SHA-256 hash, so the secret never holds a usable token:

```json
{ "<sha256 hex>": { "user": "alexander", "maxBytes": 20971520 } }
```

```bash
node scripts/new-publish-token.mjs alexander 20   # prints the token and its JSON entry
npx wrangler secret put PUBLISH_TOKENS            # paste the full JSON object
```

Send the token as `Authorization: Bearer <token>` on REST requests or on the MCP connection. To revoke a token, remove its entry and put the secret again.

## MCP

Connect a Streamable HTTP MCP client to:

```text
https://artifacts.nikitayugov.com/mcp
```

The server exposes `publish_html` with `html` and optional `ttlSeconds` arguments. With a personal token on the connection, it also accepts `name` and `note` to publish a named doc. It returns the public URL as text and `{ id, url, expiresAt }` as structured content. The MCP endpoint is intentionally unauthenticated, matching the REST upload API.

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
