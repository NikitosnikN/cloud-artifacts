import { env, SELF } from "cloudflare:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { beforeEach, describe, expect, it } from "vitest";
import { createArtifactMcpServer } from "../src/mcp";

// Tokens and limits come from vitest.config.ts: anonymous 4096 bytes, alice 16384, bob default.
const ALICE = "test-token-alice";
const BOB = "test-token-bob";

const page = (title: string, body = "") =>
  `<!doctype html><html><head><title>${title}</title></head><body>${body}</body></html>`;

beforeEach(async () => {
  let cursor: string | undefined;
  do {
    const listing = await env.ARTIFACTS.list({ cursor });
    if (listing.objects.length) await env.ARTIFACTS.delete(listing.objects.map((object) => object.key));
    cursor = listing.truncated ? listing.cursor : undefined;
  } while (cursor);
});

describe("personal publish tokens", () => {
  it("keeps the default limit for anonymous uploads and raises it for token holders", async () => {
    const big = page("Big", "x".repeat(8000));

    const anonymous = await uploadArtifact(big);
    expect(anonymous.status).toBe(413);
    expect((await anonymous.json<{ error: string }>()).error).toContain("personal publish token");

    const withToken = await uploadArtifact(big, ALICE);
    expect(withToken.status).toBe(201);
    const { id } = await withToken.json<{ id: string }>();
    expect((await env.ARTIFACTS.head(`artifacts/${id}.html`))?.customMetadata?.author).toBe("alice");

    expect((await uploadArtifact(page("Huge", "x".repeat(20000)), ALICE)).status).toBe(413);
  });

  it("falls back to the default limit when a token has no maxBytes", async () => {
    expect((await uploadArtifact(page("Big", "x".repeat(8000)), BOB)).status).toBe(413);
    expect((await uploadArtifact(page("Small"), BOB)).status).toBe(201);
  });

  it("rejects unknown tokens and malformed headers instead of treating them as anonymous", async () => {
    expect((await uploadArtifact(page("Small"), "wrong-token")).status).toBe(401);
    const malformed = await appFetch("https://example.com/api/artifacts", {
      method: "POST",
      headers: htmlHeaders(page("Small"), { authorization: "Basic abc" }),
      body: page("Small"),
    });
    expect(malformed.status).toBe(401);
  });

  it("still enforces the IP allowlist for token holders", async () => {
    const html = page("Blocked");
    const response = await SELF.fetch("https://example.com/api/docs/blocked", {
      method: "PUT",
      headers: { ...htmlHeaders(html, { authorization: `Bearer ${ALICE}` }), "cf-connecting-ip": "198.51.100.7" },
      body: html,
    });
    expect(response.status).toBe(403);
  });
});

describe("named docs", () => {
  it("requires a token to publish", async () => {
    const response = await publishDoc("tron-energy-atlas", page("Atlas"));
    expect(response.status).toBe(401);
    expect(await env.ARTIFACTS.head("docs/tron-energy-atlas.json")).toBeNull();
  });

  it("rejects invalid names", async () => {
    expect((await publishDoc("Bad_Name", page("Atlas"), ALICE)).status).toBe(400);
    expect((await publishDoc("-leading", page("Atlas"), ALICE)).status).toBe(400);
    expect((await appFetch("https://example.com/d/Bad_Name")).status).toBe(404);
  });

  it("keeps one link while versions change, and pins old versions", async () => {
    const first = await publishDoc("tron-energy-atlas", page("TRON Energy Atlas", "one"), ALICE);
    expect(first.status).toBe(201);
    const v1 = await first.json<{ url: string; version: number; versionUrl: string; title: string }>();
    expect(v1).toMatchObject({
      version: 1,
      title: "TRON Energy Atlas",
      url: "https://artifacts.nikitayugov.com/d/tron-energy-atlas",
      versionUrl: "https://artifacts.nikitayugov.com/d/tron-energy-atlas/v/1",
    });

    const second = await publishDoc("tron-energy-atlas", page("TRON Energy Atlas v2", "two"), BOB, "fixed%20typos");
    const v2 = await second.json<{ url: string; version: number }>();
    expect(v2.url).toBe(v1.url);
    expect(v2.version).toBe(2);

    const current = await appFetch("https://example.com/d/tron-energy-atlas");
    expect(current.status).toBe(200);
    expect(await current.text()).toContain("two");
    expect(current.headers.get("cache-control")).toBe("no-cache");
    expect(current.headers.get("x-doc-version")).toBe("2");
    expect(current.headers.get("content-security-policy")).toContain("sandbox");

    const pinned = await appFetch("https://example.com/d/tron-energy-atlas/v/1");
    expect(await pinned.text()).toContain("one");
    expect(pinned.headers.get("cache-control")).toContain("immutable");

    const card = await (await appFetch("https://example.com/api/docs/tron-energy-atlas")).json<{
      title: string;
      current: number;
      versions: { version: number; author: string; note?: string }[];
    }>();
    expect(card.title).toBe("TRON Energy Atlas v2");
    expect(card.current).toBe(2);
    expect(card.versions.map((entry) => [entry.version, entry.author])).toEqual([[1, "alice"], [2, "bob"]]);
    expect(card.versions[1].note).toBe("fixed typos");
  });

  it("supports conditional GET and HEAD on the permanent link", async () => {
    await publishDoc("handbook", page("Handbook"), ALICE);
    const first = await appFetch("https://example.com/d/handbook");
    const etag = first.headers.get("etag");
    expect(etag).toBeTruthy();

    const notModified = await appFetch("https://example.com/d/handbook", { headers: { "if-none-match": etag! } });
    expect(notModified.status).toBe(304);

    await publishDoc("handbook", page("Handbook", "new"), ALICE);
    const changed = await appFetch("https://example.com/d/handbook", { headers: { "if-none-match": etag! } });
    expect(changed.status).toBe(200);

    const head = await appFetch("https://example.com/d/handbook", { method: "HEAD" });
    expect(head.status).toBe(200);
    expect(head.headers.get("content-length")).toBeTruthy();
    expect(await head.text()).toBe("");
  });

  it("rolls back by moving the pointer only", async () => {
    await publishDoc("guide", page("Guide", "one"), ALICE);
    await publishDoc("guide", page("Guide", "two"), ALICE);

    expect((await rollback("guide", "1")).status).toBe(401);
    const rolled = await rollback("guide", "1", ALICE);
    expect(rolled.status).toBe(200);
    expect(await (await appFetch("https://example.com/d/guide")).text()).toContain("one");
    expect(await (await appFetch("https://example.com/d/guide/v/2")).text()).toContain("two");

    expect((await rollback("guide", "9", ALICE)).status).toBe(404);
    expect((await rollback("missing", "1", ALICE)).status).toBe(404);
    expect((await rollback("guide", "abc", ALICE)).status).toBe(400);

    const third = await (await publishDoc("guide", page("Guide", "three"), ALICE)).json<{ version: number }>();
    expect(third.version).toBe(3);
  });

  it("gives every concurrent publish its own version", async () => {
    await publishDoc("busy", page("Busy", "seed"), ALICE);
    const responses = await Promise.all(
      [1, 2, 3, 4].map((n) => publishDoc("busy", page("Busy", `edit ${n}`), ALICE)),
    );
    expect(responses.map((response) => response.status)).toEqual([201, 201, 201, 201]);

    const card = await (await appFetch("https://example.com/api/docs/busy")).json<{
      versions: { version: number; id: string }[];
    }>();
    expect(card.versions.map((entry) => entry.version)).toEqual([1, 2, 3, 4, 5]);
    expect(new Set(card.versions.map((entry) => entry.id)).size).toBe(5);
  });

  it("returns 404 for unknown docs and versions", async () => {
    expect((await appFetch("https://example.com/d/nothing")).status).toBe(404);
    await publishDoc("one-version", page("One"), ALICE);
    expect((await appFetch("https://example.com/d/one-version/v/2")).status).toBe(404);
    expect((await appFetch("https://example.com/api/docs/nothing")).status).toBe(404);
  });

  it("rejects wrong methods", async () => {
    expect((await appFetch("https://example.com/d/guide", { method: "POST" })).status).toBe(405);
    expect((await appFetch("https://example.com/api/docs/guide", { method: "DELETE" })).status).toBe(405);
    expect((await appFetch("https://example.com/api/docs/guide/rollback")).status).toBe(405);
  });
});

describe("catalog and history pages", () => {
  it("lists docs with escaped titles, newest first", async () => {
    await publishDoc("older", page("Older doc"), ALICE);
    await publishDoc("newer", page("&lt;script&gt;alert(1)&lt;/script&gt; Атлас"), BOB);

    const response = await appFetch("https://example.com/d/");
    expect(response.status).toBe(200);
    expect(response.headers.get("content-security-policy")).toContain("default-src 'none'");
    const html = await response.text();
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt; Атлас");
    expect(html.indexOf("/d/newer")).toBeLessThan(html.indexOf("/d/older"));

    const list = await (await appFetch("https://example.com/api/docs")).json<{ docs: { name: string; title: string }[] }>();
    expect(list.docs.map((doc) => doc.name)).toEqual(["newer", "older"]);
    expect(list.docs[0].title).toBe("<script>alert(1)</script> Атлас");
  });

  it("shows an empty catalog", async () => {
    const html = await (await appFetch("https://example.com/d")).text();
    expect(html).toContain("No docs yet");
  });

  it("shows version history with the current marker", async () => {
    await publishDoc("guide", page("Guide"), ALICE);
    await publishDoc("guide", page("Guide"), BOB, "second");
    const html = await (await appFetch("https://example.com/d/guide/history")).text();
    expect(html).toContain("/d/guide/v/1");
    expect(html).toContain("/d/guide/v/2");
    expect(html).toContain("current");
    expect(html).toContain("second");
    expect((await appFetch("https://example.com/d/missing/history")).status).toBe(404);
  });

  it("links the catalog from the landing page", async () => {
    expect(await (await appFetch("https://example.com/")).text()).toContain('href="/d/"');
  });
});

describe("MCP named docs", () => {
  it("publishes a named doc only with a publisher", async () => {
    const anonymous = await callPublish(null, { html: page("Atlas"), name: "atlas" });
    expect(anonymous.isError).toBe(true);

    const withTtl = await callPublish({ user: "alice", maxBytes: 16384 }, { html: page("Atlas"), name: "atlas", ttlSeconds: 60 });
    expect(withTtl.isError).toBe(true);

    const published = await callPublish({ user: "alice", maxBytes: 16384 }, { html: page("Atlas"), name: "atlas", note: "first" });
    expect(published.isError).not.toBe(true);
    expect(published.structuredContent).toMatchObject({
      name: "atlas",
      version: 1,
      url: "https://artifacts.nikitayugov.com/d/atlas",
    });
  });

  it("applies the personal size limit to anonymous-style MCP uploads", async () => {
    const big = page("Big", "x".repeat(8000));
    expect((await callPublish(null, { html: big })).isError).toBe(true);
    expect((await callPublish({ user: "alice", maxBytes: 16384 }, { html: big })).isError).not.toBe(true);
  });

  it("rejects an unknown token on the MCP endpoint", async () => {
    const response = await appFetch("https://example.com/mcp", {
      method: "POST",
      headers: {
        accept: "application/json, text/event-stream",
        authorization: "Bearer wrong-token",
        "content-type": "application/json",
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} }),
    });
    expect(response.status).toBe(401);
  });
});

async function callPublish(
  publisher: { user: string; maxBytes: number } | null,
  args: Record<string, unknown>,
): Promise<{ isError?: boolean; structuredContent?: unknown }> {
  const server = createArtifactMcpServer(env, publisher);
  const client = new Client({ name: "cloud-artifacts-test", version: "1.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  try {
    return (await client.callTool({ name: "publish_html", arguments: args })) as {
      isError?: boolean;
      structuredContent?: unknown;
    };
  } finally {
    await client.close();
    await server.close();
  }
}

function publishDoc(name: string, html: string, token?: string, note?: string): Promise<Response> {
  const extra: Record<string, string> = {};
  if (token) extra.authorization = `Bearer ${token}`;
  if (note) extra["x-doc-note"] = note;
  return appFetch(`https://example.com/api/docs/${name}`, { method: "PUT", headers: htmlHeaders(html, extra), body: html });
}

function rollback(name: string, to: string, token?: string): Promise<Response> {
  return appFetch(`https://example.com/api/docs/${name}/rollback?to=${to}`, {
    method: "POST",
    headers: token ? { authorization: `Bearer ${token}` } : {},
  });
}

function uploadArtifact(html: string, token?: string): Promise<Response> {
  return appFetch("https://example.com/api/artifacts", {
    method: "POST",
    headers: htmlHeaders(html, token ? { authorization: `Bearer ${token}` } : {}),
    body: html,
  });
}

function htmlHeaders(html: string, extra: Record<string, string> = {}): Record<string, string> {
  return {
    "content-length": String(new TextEncoder().encode(html).byteLength),
    "content-type": "text/html; charset=utf-8",
    "x-artifact-upload": "1",
    ...extra,
  };
}

function appFetch(input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set("cf-connecting-ip", "203.0.113.10");
  return SELF.fetch(input, { ...init, headers });
}
