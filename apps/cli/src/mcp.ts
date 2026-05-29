import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js"
import type { LogLevelLabel } from "@sermon-search/types"
import { z } from "zod"
import { type AdminClient, createClient } from "./client.js"
import type { ResolvedInstance } from "./instance.js"

const LOG_LEVELS = ["trace", "debug", "info", "warn", "error", "fatal"] as const satisfies [
  string,
  ...string[],
]

type ToolResult = {
  content: [{ type: "text"; text: string }]
  structuredContent?: Record<string, unknown>
  isError?: boolean
}

function ok(data: unknown): ToolResult {
  return {
    content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
    structuredContent: { result: data } as Record<string, unknown>,
  }
}

function err(e: unknown): ToolResult {
  const msg = e instanceof Error ? e.message : String(e)
  return { isError: true, content: [{ type: "text", text: msg }] }
}

export function buildMcpServer(client: AdminClient): McpServer {
  const server = new McpServer({ name: "sermon-admin", version: "0.0.0" })

  server.tool("health", "Check instance worker health and system run status", {}, async () => {
    try {
      return ok(await client.health())
    } catch (e) {
      return err(e)
    }
  })

  server.tool(
    "churches_list",
    "List all registered churches",
    {
      slug_prefix: z.string().optional().describe("Filter by slug prefix"),
      limit: z.number().int().min(1).max(100).optional().default(20),
      offset: z.number().int().min(0).optional().default(0),
    },
    async (input) => {
      try {
        return ok(await client.churchesList(input))
      } catch (e) {
        return err(e)
      }
    },
  )

  server.tool(
    "church_get",
    "Get church detail including channels, aliases, and video count",
    { id: z.string().uuid().describe("Church UUID") },
    async ({ id }) => {
      try {
        return ok(await client.churchGet(id))
      } catch (e) {
        return err(e)
      }
    },
  )

  server.tool(
    "requests_list",
    "List ingestion requests",
    {
      status: z
        .enum([
          "received",
          "running",
          "awaiting_approval",
          "approved",
          "denied",
          "failed",
          "complete",
        ])
        .optional()
        .describe("Filter by status"),
      user_id: z.string().uuid().optional().describe("Filter by user UUID"),
      limit: z.number().int().min(1).max(100).optional().default(20),
      offset: z.number().int().min(0).optional().default(0),
    },
    async (input) => {
      try {
        return ok(await client.requestsList(input))
      } catch (e) {
        return err(e)
      }
    },
  )

  server.tool(
    "request_get",
    "Get ingestion request detail",
    { id: z.string().uuid().describe("Request UUID") },
    async ({ id }) => {
      try {
        return ok(await client.requestGet(id))
      } catch (e) {
        return err(e)
      }
    },
  )

  server.tool(
    "request_retry",
    "Retry a failed ingestion request — re-queues it for the worker (admin mutation — writes audit row with actor=cli)",
    { id: z.string().uuid().describe("Request UUID") },
    async ({ id }) => {
      try {
        return ok(await client.requestRetry(id))
      } catch (e) {
        return err(e)
      }
    },
  )

  server.tool(
    "channel_add",
    "Register a YouTube channel for a church (admin mutation — writes audit row with actor=cli)",
    {
      churchSlug: z.string().min(1).describe("Church slug"),
      handle: z
        .string()
        .optional()
        .describe("YouTube channel handle (provide exactly one of handle or youtubeChannelId)"),
      youtubeChannelId: z
        .string()
        .optional()
        .describe("YouTube channel ID (provide exactly one of handle or youtubeChannelId)"),
    },
    async (input) => {
      if (Boolean(input.handle) === Boolean(input.youtubeChannelId)) {
        return err(new Error("Provide exactly one of handle or youtubeChannelId"))
      }
      try {
        return ok(await client.channelAdd(input))
      } catch (e) {
        return err(e)
      }
    },
  )

  server.tool(
    "channel_refresh",
    "Refresh channel/playlist/video metadata for a church (admin mutation — writes audit row with actor=cli)",
    {
      churchSlug: z.string().min(1).describe("Church slug"),
      force: z.boolean().optional().describe("Force refresh even if cached"),
      channel: z.string().optional().describe("Limit refresh to a specific channel handle or ID"),
    },
    async (input) => {
      try {
        return ok(await client.channelRefresh(input))
      } catch (e) {
        return err(e)
      }
    },
  )

  server.tool(
    "channel_view_stats",
    "Update playlist view statistics for a church (admin mutation — writes audit row with actor=cli)",
    { churchSlug: z.string().min(1).describe("Church slug") },
    async ({ churchSlug }) => {
      try {
        return ok(await client.channelViewStats(churchSlug))
      } catch (e) {
        return err(e)
      }
    },
  )

  server.tool(
    "audit_list",
    "List admin audit log entries",
    {
      limit: z.number().int().min(1).max(100).optional().default(50),
      offset: z.number().int().min(0).optional().default(0),
      action: z.string().optional().describe("Filter by action name"),
      target_type: z.string().optional().describe("Filter by target type"),
      user_id: z.string().uuid().optional().describe("Filter by user UUID"),
    },
    async (input) => {
      try {
        return ok(await client.auditList(input))
      } catch (e) {
        return err(e)
      }
    },
  )

  server.tool(
    "recent_logs",
    "Fetch recent log records from the instance ring buffer (non-streaming snapshot)",
    {
      level: z.enum(LOG_LEVELS).optional().describe("Minimum log level"),
      since: z
        .string()
        .regex(/^\d+[smh]$/)
        .optional()
        .describe("Show only records from the past duration (e.g. 5m, 30s, 2h)"),
      limit: z.number().int().min(1).max(500).optional().default(200),
    },
    async (input) => {
      try {
        const records = await client.recentLogs({
          level: input.level as LogLevelLabel | undefined,
          since: input.since,
          limit: input.limit,
        })
        return ok(records)
      } catch (e) {
        return err(e)
      }
    },
  )

  return server
}

export async function runMcpServer(instance: ResolvedInstance): Promise<void> {
  const client = createClient(instance)
  const server = buildMcpServer(client)
  const transport = new StdioServerTransport()
  process.stderr.write(`sermon-admin MCP server ready (instance: ${instance.name})\n`)
  await server.connect(transport)
}
