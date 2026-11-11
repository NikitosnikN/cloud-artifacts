#!/usr/bin/env node
// Creates a personal publish token and the PUBLISH_TOKENS entry for it.
// Usage: node scripts/new-publish-token.mjs <user> [maxMegabytes]
// Give the token to the person privately; only its SHA-256 hash goes into the secret.

import { createHash, randomBytes } from "node:crypto";

const [user, megabytes = "20"] = process.argv.slice(2);
const limit = Number(megabytes);

if (!user || !/^[A-Za-z0-9._-]{1,64}$/.test(user) || !Number.isFinite(limit) || limit <= 0) {
  console.error("Usage: node scripts/new-publish-token.mjs <user> [maxMegabytes]");
  process.exit(1);
}

const token = `cap_${randomBytes(32).toString("base64url")}`;
const hash = createHash("sha256").update(token).digest("hex");
const entry = { [hash]: { user, maxBytes: Math.round(limit * 1024 * 1024) } };

console.log(`Token for ${user} (shown once, send it privately):\n${token}\n`);
console.log(`Merge this entry into the PUBLISH_TOKENS JSON, then run: npx wrangler secret put PUBLISH_TOKENS\n${JSON.stringify(entry, null, 2)}`);
