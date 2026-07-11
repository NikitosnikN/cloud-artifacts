import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { createMcpHandler } from "agents/mcp";
import { z } from "zod";
import { parsePositiveInteger } from "./parsing";
import { ArtifactValidationError, publishArtifact } from "./upload";

export const MCP_PATH = "/mcp";

export function createArtifactMcpServer(env: Env): McpServer {
  const server = new McpServer({ name: "cloud-artifacts", version: "0.2.0" });

  server.registerTool(
    "publish_html",
    {
      title: "Publish HTML artifact",
      description: "Publish a complete UTF-8 HTML document and return an immutable public URL. Optionally expire it after a TTL in seconds.",
      inputSchema: {
        html: z.string().describe("Complete HTML document beginning with <!doctype html> or <html>."),
        ttlSeconds: z.number().int().positive().max(parsePositiveInteger(env.MAX_TTL_SECONDS)).optional()
          .describe("Optional lifetime in seconds, up to one year."),
      },
      annotations: {
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
        readOnlyHint: false,
      },
    },
    async ({ html, ttlSeconds }) => {
      try {
        const artifact = await publishArtifact(new TextEncoder().encode(html), ttlSeconds ?? null, env);
        return {
          content: [{ type: "text", text: artifact.url }],
          structuredContent: artifact,
        };
      } catch (error) {
        const message = error instanceof ArtifactValidationError ? error.message : "Failed to publish HTML artifact";
        if (!(error instanceof ArtifactValidationError)) {
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

export function handleMcp(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  return createMcpHandler(createArtifactMcpServer(env))(request, env, ctx);
}
