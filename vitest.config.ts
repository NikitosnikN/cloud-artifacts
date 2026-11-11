import { createHash } from "node:crypto";
import { cloudflareTest } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");

// Test-only tokens. alice has a personal 16 KiB limit; bob falls back to MAX_HTML_BYTES.
const PUBLISH_TOKENS = JSON.stringify({
  [sha256("test-token-alice")]: { user: "alice", maxBytes: 16384 },
  [sha256("test-token-bob")]: { user: "bob" },
});

export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: "./wrangler.jsonc" },
      miniflare: {
        bindings: {
          UPLOAD_ALLOWED_IPS: ["203.0.113.10"],
          // Small anonymous limit so size tests stay fast.
          MAX_HTML_BYTES: "4096",
          PUBLISH_TOKENS,
        },
      },
    }),
  ],
});
