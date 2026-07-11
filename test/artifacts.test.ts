import { env, SELF } from "cloudflare:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { beforeEach, describe, expect, it } from "vitest";
import { cleanupExpired } from "../src/index";
import { requireAllowedIp } from "../src/access";
import { createArtifactMcpServer } from "../src/mcp";

const HTML = "<!doctype html><html><body><h1>Hello</h1></body></html>";

beforeEach(async () => {
  let cursor: string | undefined;
  do {
    const page = await env.ARTIFACTS.list({ cursor });
    if (page.objects.length) await env.ARTIFACTS.delete(page.objects.map((object) => object.key));
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);
});

describe("artifact upload and serving", () => {
  it("stores HTML and serves both UUID URL forms", async () => {
    const response = await upload(HTML);
    expect(response.status).toBe(201);
    const result = await response.json<{ id: string; url: string; expiresAt: string | null }>();
    expect(result.url).toBe(`https://artifacts.nikitayugov.com/${result.id}.html`);
    expect(result.expiresAt).toBeNull();

    const publicResponse = await appFetch(`https://example.com/${result.id}`);
    expect(publicResponse.status).toBe(200);
    expect(publicResponse.headers.get("content-security-policy")).toContain("sandbox");
    expect(await publicResponse.text()).toBe(HTML);
    expect((await appFetch(`https://example.com/${result.id}.html`)).status).toBe(200);
  });

  it("stores optional TTL metadata", async () => {
    const result = await (await upload(HTML, "60")).json<{ id: string; expiresAt: string | null }>();
    const object = await env.ARTIFACTS.head(`artifacts/${result.id}.html`);
    expect(object?.customMetadata?.expiresAt).toBe(result.expiresAt);
  });

  it("rejects non-HTML, fragments, and missing guard headers", async () => {
    const wrongType = await appFetch("https://example.com/api/artifacts", {
      method: "POST",
      headers: { "content-length": "2", "content-type": "text/plain", "x-artifact-upload": "1" },
      body: "hi",
    });
    expect(wrongType.status).toBe(415);
    expect((await upload("<h1>fragment</h1>")).status).toBe(422);

    const noGuard = await appFetch("https://example.com/api/artifacts", {
      method: "POST",
      headers: { "content-length": String(HTML.length), "content-type": "text/html" },
      body: HTML,
    });
    expect(noGuard.status).toBe(400);
  });
});

describe("landing page", () => {
  it("describes the service and links to its source", async () => {
    const response = await appFetch("https://example.com/");
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("text/html; charset=utf-8");
    expect(response.headers.get("content-security-policy")).toContain("default-src 'none'");
    const html = await response.text();
    expect(html).toContain("Share HTML");
    expect(html).toContain("https://github.com/NikitosnikN/cloud-artifacts");
    expect(html).toContain("publish_html");
  });

  it("supports HEAD without a response body", async () => {
    const response = await appFetch("https://example.com/", { method: "HEAD" });
    expect(response.status).toBe(200);
    expect(await response.text()).toBe("");
  });
});

describe("skill document", () => {
  it("serves the packaged skill source at /SKILL.md", async () => {
    const response = await appFetch("https://example.com/SKILL.md");
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("text/markdown; charset=utf-8");
    expect(response.headers.get("access-control-allow-origin")).toBe("*");
    const markdown = await response.text();
    expect(markdown).toContain("name: share-artifact");
    expect(markdown).toContain("https://artifacts.nikitayugov.com/mcp");
  });

  it("supports HEAD without returning the skill body", async () => {
    const response = await appFetch("https://example.com/SKILL.md", { method: "HEAD" });
    expect(response.status).toBe(200);
    expect(await response.text()).toBe("");
  });
});

describe("TTL cleanup", () => {
  it("returns 410 for expired artifacts", async () => {
    const id = "123e4567-e89b-42d3-a456-426614174000";
    await env.ARTIFACTS.put(`artifacts/${id}.html`, HTML, {
      customMetadata: { expiresAt: "2020-01-01T00:00:00.000Z" },
    });
    expect((await appFetch(`https://example.com/${id}`)).status).toBe(410);
  });

  it("deletes expired objects and preserves permanent objects", async () => {
    await env.ARTIFACTS.put("artifacts/expired.html", HTML, {
      customMetadata: { expiresAt: "2020-01-01T00:00:00.000Z" },
    });
    await env.ARTIFACTS.put("artifacts/permanent.html", HTML);
    expect(await cleanupExpired(env, Date.now())).toEqual({ scanned: 2, deleted: 1 });
    expect(await env.ARTIFACTS.head("artifacts/expired.html")).toBeNull();
    expect(await env.ARTIFACTS.head("artifacts/permanent.html")).not.toBeNull();
  });
});

describe("MCP server", () => {
  it("lists and calls publish_html through the MCP protocol", async () => {
    const server = createArtifactMcpServer(env);
    const client = new Client({ name: "cloud-artifacts-test", version: "1.0.0" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
    try {
      const tools = await client.listTools();
      expect(tools.tools.map((tool) => tool.name)).toContain("publish_html");

      const result = await client.callTool({
        name: "publish_html",
        arguments: { html: HTML, ttlSeconds: 60 },
      });
      expect(result.isError).not.toBe(true);
      expect(result.structuredContent).toMatchObject({
        url: expect.stringMatching(/^https:\/\/artifacts\.nikitayugov\.com\/.+\.html$/),
      });
    } finally {
      await client.close();
      await server.close();
    }
  });

  it("serves Streamable HTTP initialization at /mcp", async () => {
    const response = await appFetch("https://example.com/mcp", {
      method: "POST",
      headers: {
        accept: "application/json, text/event-stream",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2025-06-18",
          capabilities: {},
          clientInfo: { name: "cloud-artifacts-test", version: "1.0.0" },
        },
      }),
    });
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toMatch(/application\/json|text\/event-stream/);
  });
});

describe("IP allowlist", () => {
  it("accepts configured IPs and rejects other sources", () => {
    const allowed = new Request("https://example.com", {
      headers: { "cf-connecting-ip": "203.0.113.10" },
    });
    const denied = new Request("https://example.com", {
      headers: { "cf-connecting-ip": "203.0.113.11" },
    });

    expect(requireAllowedIp(allowed, ["203.0.113.10"])).toBeNull();
    expect(requireAllowedIp(denied, ["203.0.113.10"])?.status).toBe(403);
    expect(requireAllowedIp(denied, ["*"])).toBeNull();
  });

  it("blocks both artifact reads and REST writes before routing", async () => {
    const blockedHeaders = { "cf-connecting-ip": "178.134.138.52" };
    const read = await SELF.fetch("https://example.com/123e4567-e89b-42d3-a456-426614174000.html", {
      headers: blockedHeaders,
    });
    const write = await SELF.fetch("https://example.com/api/artifacts", {
      method: "POST",
      headers: {
        ...blockedHeaders,
        "content-length": String(HTML.length),
        "content-type": "text/html",
        "x-artifact-upload": "1",
      },
      body: HTML,
    });

    expect(read.status).toBe(403);
    expect(write.status).toBe(403);
  });
});

function upload(html: string, ttl?: string): Promise<Response> {
  const url = new URL("https://example.com/api/artifacts");
  if (ttl) url.searchParams.set("ttl", ttl);
  return appFetch(url, {
    method: "POST",
    headers: {
      "content-length": String(new TextEncoder().encode(html).byteLength),
      "content-type": "text/html; charset=utf-8",
      "x-artifact-upload": "1",
    },
    body: html,
  });
}

function appFetch(input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set("cf-connecting-ip", "203.0.113.10");
  return SELF.fetch(input, { ...init, headers });
}
