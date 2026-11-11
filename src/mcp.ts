import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { createMcpHandler } from "agents/mcp";
import { z } from "zod";
import { identifyPublisher, uploadLimit, type Publisher } from "./auth";
import { DOC_NAME_PATTERN, DocError, docResponse, isKnownError, publishDocVersion } from "./docs";
import { parsePositiveInteger } from "./parsing";
import { publishArtifact } from "./upload";

export const MCP_PATH = "/mcp";

/**
 * `publisher` comes from the MCP request's `Authorization: Bearer <token>` header.
 * Without it, publish_html behaves exactly as before (anonymous, default size limit).
 */
export function createArtifactMcpServer(env: Env, publisher: Publisher | null = null): McpServer {
  const server = new McpServer({ name: "cloud-artifacts", version: "0.3.0" });

  server.registerTool(
    "publish_html",
    {
      title: "Publish HTML artifact",
      description: "Publish a complete UTF-8 HTML document and return its URL. Without `name`, creates an immutable page at a new URL, optionally expiring after a TTL in seconds. With `name`, publishes a new version of a named doc at a permanent link that always shows the latest version (requires a personal publish token).",
      inputSchema: {
        html: z.string().describe("Complete HTML document beginning with <!doctype html> or <html>."),
        ttlSeconds: z.number().int().positive().max(parsePositiveInteger(env.MAX_TTL_SECONDS)).optional()
          .describe("Optional lifetime in seconds, up to one year. Not allowed with `name`."),
        name: z.string().regex(DOC_NAME_PATTERN).optional()
          .describe("Permanent doc name such as tron-energy-atlas (a-z, 0-9, dashes). Publishes a new version at /d/{name}."),
        note: z.string().max(200).optional()
          .describe("Optional short change note for this version. Only used with `name`."),
      },
      annotations: {
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
        readOnlyHint: false,
      },
    },
    async ({ html, ttlSeconds, name, note }) => {
      try {
        const data = new TextEncoder().encode(html);
        if (name !== undefined) {
          if (!publisher) {
            throw new DocError("Publishing a named doc requires a personal publish token in the Authorization header", 401);
          }
          if (ttlSeconds !== undefined) throw new DocError("Named docs never expire; omit ttlSeconds", 400);
          const doc = docResponse(env, await publishDocVersion(env, name, data, publisher, note));
          return { content: [{ type: "text", text: doc.url }], structuredContent: doc };
        }

        const artifact = await publishArtifact(data, ttlSeconds ?? null, env, {
          maxBytes: uploadLimit(publisher, env),
          author: publisher?.user,
        });
        return {
          content: [{ type: "text", text: artifact.url }],
          structuredContent: artifact,
        };
      } catch (error) {
        const message = isKnownError(error) ? error.message : "Failed to publish HTML artifact";
        if (!isKnownError(error)) {
          console.error(JSON.stringify({
            event: "mcp_publish_failed",
            error: error instanceof Error ? error.message : String(error),
          }));
        }
        return { content: [{ type: "text", text: message }], isError: true };
      }
    },
  );

  return server;
}

export async function handleMcp(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const publisher = await identifyPublisher(request, env);
  if (publisher instanceof Response) return publisher;
  return createMcpHandler(createArtifactMcpServer(env, publisher))(request, env, ctx);
}
