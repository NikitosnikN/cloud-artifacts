// Secrets are not part of `wrangler types` output, so they are declared here.
// Set with: npx wrangler secret put PUBLISH_TOKENS
//
// PUBLISH_TOKENS is a JSON object keyed by the SHA-256 hex digest of each personal token:
//   { "<sha256 hex>": { "user": "alexander", "maxBytes": 20971520 } }
// `maxBytes` is optional and defaults to MAX_HTML_BYTES. Create entries with
// `node scripts/new-publish-token.mjs <user> [megabytes]`.

declare namespace Cloudflare {
  interface Env {
    PUBLISH_TOKENS?: string;
  }
}

interface Env {
  PUBLISH_TOKENS?: string;
}
