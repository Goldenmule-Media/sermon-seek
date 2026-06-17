import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js"
import { describe, expect, it, vi } from "vitest"
import type { AdminClient, AuditListQuery, ChurchesListQuery, RequestsListQuery } from "./client.js"
import { buildMcpServer } from "./mcp.js"

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

type MockClient = { [K in keyof AdminClient]: ReturnType<typeof vi.fn> }

function makeMock(): MockClient {
  return {
    health: vi.fn(),
    recentLogs: vi.fn(),
    churchesList: vi.fn(),
    churchGet: vi.fn(),
    requestsList: vi.fn(),
    requestGet: vi.fn(),
    channelAdd: vi.fn(),
    channelRefresh: vi.fn(),
    channelViewStats: vi.fn(),
    auditList: vi.fn(),
    requestRetry: vi.fn(),
  }
}

async function makeClient(
  adminClient: AdminClient,
): Promise<{ mcp: Client; close: () => Promise<void> }> {
  const server = buildMcpServer(adminClient)
  const [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair()
  const mcp = new Client({ name: "test-client", version: "0.0.0" })
  await server.connect(serverTransport)
  await mcp.connect(clientTransport)
  return {
    mcp,
    close: async () => {
      await mcp.close()
    },
  }
}

// ---------------------------------------------------------------------------
// tool registration
// ---------------------------------------------------------------------------

describe("buildMcpServer — tool list", () => {
  it("registers all expected tools", async () => {
    const mock = makeMock()
    const { mcp, close } = await makeClient(mock as unknown as AdminClient)

    try {
      const { tools } = await mcp.listTools()
      const names = tools.map((t) => t.name).sort()
      expect(names).toEqual(
        [
          "audit_list",
          "channel_add",
          "channel_refresh",
          "channel_reingest",
          "channel_view_stats",
          "church_get",
          "churches_list",
          "health",
          "recent_logs",
          "request_get",
          "request_retry",
          "requests_list",
        ].sort(),
      )
    } finally {
      await close()
    }
  })
})

// ---------------------------------------------------------------------------
// health
// ---------------------------------------------------------------------------

describe("health tool", () => {
  it("returns client.health() result as JSON content", async () => {
    const healthData = {
      workers: [],
      view_stats: { last_run_at: null, last_status: null },
      smoke_test: { last_run_at: null, last_status: null },
    }
    const mock = makeMock()
    mock.health.mockResolvedValueOnce(healthData)

    const { mcp, close } = await makeClient(mock as unknown as AdminClient)
    try {
      const result = await mcp.callTool({ name: "health", arguments: {} })
      expect(mock.health).toHaveBeenCalledOnce()
      expect(result.isError).toBeFalsy()
      expect(result.content[0]).toMatchObject({ type: "text" })
      const parsed = JSON.parse((result.content[0] as { text: string }).text)
      expect(parsed).toEqual(healthData)
    } finally {
      await close()
    }
  })

  it("returns isError:true when client.health() throws", async () => {
    const mock = makeMock()
    mock.health.mockRejectedValueOnce(
      new Error('Admin key rejected for instance "test". Check your stored key.'),
    )

    const { mcp, close } = await makeClient(mock as unknown as AdminClient)
    try {
      const result = await mcp.callTool({ name: "health", arguments: {} })
      expect(result.isError).toBe(true)
      expect((result.content[0] as { text: string }).text).toContain("Admin key rejected")
    } finally {
      await close()
    }
  })
})

// ---------------------------------------------------------------------------
// recent_logs
// ---------------------------------------------------------------------------

describe("recent_logs tool", () => {
  it("passes level and since to client.recentLogs and returns JSON content", async () => {
    const records = [
      { time: 1_700_000_000_000, level: 30, levelLabel: "info", msg: "hi", fields: {} },
    ]
    const mock = makeMock()
    mock.recentLogs.mockResolvedValueOnce(records)

    const { mcp, close } = await makeClient(mock as unknown as AdminClient)
    try {
      const result = await mcp.callTool({
        name: "recent_logs",
        arguments: { level: "info", since: "5m", limit: 50 },
      })
      expect(mock.recentLogs).toHaveBeenCalledWith({ level: "info", since: "5m", limit: 50 })
      expect(result.isError).toBeFalsy()
      const parsed = JSON.parse((result.content[0] as { text: string }).text)
      expect(parsed).toEqual(records)
    } finally {
      await close()
    }
  })

  it("returns isError:true when client.recentLogs throws", async () => {
    const mock = makeMock()
    mock.recentLogs.mockRejectedValueOnce(
      new Error("Can't reach http://localhost:3001: connect ECONNREFUSED"),
    )

    const { mcp, close } = await makeClient(mock as unknown as AdminClient)
    try {
      const result = await mcp.callTool({ name: "recent_logs", arguments: {} })
      expect(result.isError).toBe(true)
      expect((result.content[0] as { text: string }).text).toContain("Can't reach")
    } finally {
      await close()
    }
  })
})

// ---------------------------------------------------------------------------
// channel_add — validates exactly-one-of handle/youtubeChannelId
// ---------------------------------------------------------------------------

describe("channel_add tool", () => {
  it("calls client.channelAdd with churchSlug and handle", async () => {
    const addResult = {
      id: "chan-1",
      youtube_channel_id: "UCfoo",
      title: "Test",
      ingested_at: "2024-01-01T00:00:00Z",
    }
    const mock = makeMock()
    mock.channelAdd.mockResolvedValueOnce(addResult)

    const { mcp, close } = await makeClient(mock as unknown as AdminClient)
    try {
      const result = await mcp.callTool({
        name: "channel_add",
        arguments: { churchSlug: "demo", handle: "@test" },
      })
      expect(mock.channelAdd).toHaveBeenCalledWith({ churchSlug: "demo", handle: "@test" })
      expect(result.isError).toBeFalsy()
      const parsed = JSON.parse((result.content[0] as { text: string }).text)
      expect(parsed.youtube_channel_id).toBe("UCfoo")
    } finally {
      await close()
    }
  })

  it("returns isError when both handle and youtubeChannelId are provided", async () => {
    const mock = makeMock()

    const { mcp, close } = await makeClient(mock as unknown as AdminClient)
    try {
      const result = await mcp.callTool({
        name: "channel_add",
        arguments: { churchSlug: "demo", handle: "@h", youtubeChannelId: "UCx" },
      })
      expect(result.isError).toBe(true)
      expect((result.content[0] as { text: string }).text).toContain("exactly one")
      expect(mock.channelAdd).not.toHaveBeenCalled()
    } finally {
      await close()
    }
  })

  it("returns isError when neither handle nor youtubeChannelId is provided", async () => {
    const mock = makeMock()

    const { mcp, close } = await makeClient(mock as unknown as AdminClient)
    try {
      const result = await mcp.callTool({ name: "channel_add", arguments: { churchSlug: "demo" } })
      expect(result.isError).toBe(true)
      expect((result.content[0] as { text: string }).text).toContain("exactly one")
      expect(mock.channelAdd).not.toHaveBeenCalled()
    } finally {
      await close()
    }
  })
})

// ---------------------------------------------------------------------------
// churches_list — query forwarding
// ---------------------------------------------------------------------------

describe("churches_list tool", () => {
  it("forwards query params to client.churchesList", async () => {
    const listResult = { items: [], total: 0 }
    const mock = makeMock()
    mock.churchesList.mockResolvedValueOnce(listResult)

    const { mcp, close } = await makeClient(mock as unknown as AdminClient)
    try {
      await mcp.callTool({
        name: "churches_list",
        arguments: { slug_prefix: "demo", limit: 10, offset: 5 },
      })
      const call = mock.churchesList.mock.calls[0][0] as ChurchesListQuery
      expect(call.slug_prefix).toBe("demo")
      expect(call.limit).toBe(10)
      expect(call.offset).toBe(5)
    } finally {
      await close()
    }
  })
})

// ---------------------------------------------------------------------------
// requests_list — query forwarding
// ---------------------------------------------------------------------------

describe("requests_list tool", () => {
  it("forwards status filter to client.requestsList", async () => {
    const listResult = { requests: [], total: 0, limit: 20, offset: 0 }
    const mock = makeMock()
    mock.requestsList.mockResolvedValueOnce(listResult)

    const { mcp, close } = await makeClient(mock as unknown as AdminClient)
    try {
      await mcp.callTool({ name: "requests_list", arguments: { status: "awaiting_approval" } })
      const call = mock.requestsList.mock.calls[0][0] as RequestsListQuery
      expect(call.status).toBe("awaiting_approval")
    } finally {
      await close()
    }
  })
})

// ---------------------------------------------------------------------------
// request_retry — forwards id to client.requestRetry
// ---------------------------------------------------------------------------

describe("request_retry tool", () => {
  it("forwards id to client.requestRetry and returns JSON content", async () => {
    const mock = makeMock()
    mock.requestRetry.mockResolvedValueOnce({ id: "req-1", status: "received" })

    const { mcp, close } = await makeClient(mock as unknown as AdminClient)
    try {
      const result = await mcp.callTool({
        name: "request_retry",
        arguments: { id: "11111111-1111-1111-1111-111111111111" },
      })
      expect(mock.requestRetry).toHaveBeenCalledWith("11111111-1111-1111-1111-111111111111")
      expect(result.isError).toBeFalsy()
      const parsed = JSON.parse((result.content[0] as { text: string }).text)
      expect(parsed.status).toBe("received")
    } finally {
      await close()
    }
  })

  it("returns isError:true when client.requestRetry throws", async () => {
    const mock = makeMock()
    mock.requestRetry.mockRejectedValueOnce(new Error("HTTP 409 from instance: invalid_transition"))

    const { mcp, close } = await makeClient(mock as unknown as AdminClient)
    try {
      const result = await mcp.callTool({
        name: "request_retry",
        arguments: { id: "11111111-1111-1111-1111-111111111111" },
      })
      expect(result.isError).toBe(true)
      expect((result.content[0] as { text: string }).text).toContain("invalid_transition")
    } finally {
      await close()
    }
  })
})

// ---------------------------------------------------------------------------
// audit_list — query forwarding
// ---------------------------------------------------------------------------

describe("audit_list tool", () => {
  it("forwards action filter to client.auditList", async () => {
    const listResult = { items: [], total: 0 }
    const mock = makeMock()
    mock.auditList.mockResolvedValueOnce(listResult)

    const { mcp, close } = await makeClient(mock as unknown as AdminClient)
    try {
      await mcp.callTool({
        name: "audit_list",
        arguments: { action: "channel.register", limit: 5 },
      })
      const call = mock.auditList.mock.calls[0][0] as AuditListQuery
      expect(call.action).toBe("channel.register")
      expect(call.limit).toBe(5)
    } finally {
      await close()
    }
  })
})
