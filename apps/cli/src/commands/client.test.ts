import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { createClient } from "../client.js"
import type { ResolvedInstance } from "../instance.js"

const INSTANCE: ResolvedInstance = {
  name: "test",
  baseUrl: "http://localhost:3001",
  adminKey: "test-key-abc",
}

function makeOkResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  })
}

describe("createClient", () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    fetchSpy = vi.spyOn(globalThis, "fetch")
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  // ── Auth header ────────────────────────────────────────────────────────────

  it("always sends x-admin-key header", async () => {
    fetchSpy.mockResolvedValue(makeOkResponse({ items: [], total: 0 }))
    const client = createClient(INSTANCE)
    await client.churchesList()
    const [, init] = fetchSpy.mock.calls[0]
    expect((init as RequestInit).headers as Record<string, string>).toMatchObject({
      "x-admin-key": "test-key-abc",
    })
  })

  it("throws friendly error on 401", async () => {
    fetchSpy.mockResolvedValue(new Response(JSON.stringify({ error: "bad key" }), { status: 401 }))
    const client = createClient(INSTANCE)
    await expect(client.churchesList()).rejects.toThrow(/Admin key rejected/)
  })

  it("throws friendly error on connection refused", async () => {
    fetchSpy.mockRejectedValue(new TypeError("fetch failed"))
    const client = createClient(INSTANCE)
    await expect(client.churchesList()).rejects.toThrow(/Can't reach/)
  })

  // ── Churches ───────────────────────────────────────────────────────────────

  it("churchesList sends GET /v1/admin/churches", async () => {
    fetchSpy.mockResolvedValue(makeOkResponse({ items: [], total: 0 }))
    const client = createClient(INSTANCE)
    const result = await client.churchesList()
    expect(result).toEqual({ items: [], total: 0 })
    const [url] = fetchSpy.mock.calls[0]
    expect(url).toContain("/v1/admin/churches")
  })

  it("churchesList passes query params", async () => {
    fetchSpy.mockResolvedValue(makeOkResponse({ items: [], total: 0 }))
    const client = createClient(INSTANCE)
    await client.churchesList({ slug_prefix: "grace", limit: 5, offset: 10 })
    const [url] = fetchSpy.mock.calls[0]
    expect(url).toContain("slug_prefix=grace")
    expect(url).toContain("limit=5")
    expect(url).toContain("offset=10")
  })

  it("churchGet sends GET /v1/admin/churches/:id", async () => {
    const detail = { id: "abc", slug: "grace", name: "Grace Chapel", status: "active" }
    fetchSpy.mockResolvedValue(makeOkResponse(detail))
    const client = createClient(INSTANCE)
    const result = await client.churchGet("abc")
    expect(result).toEqual(detail)
    const [url] = fetchSpy.mock.calls[0]
    expect(url).toContain("/v1/admin/churches/abc")
  })

  it("churchVideos sends GET /v1/admin/churches/:id/videos", async () => {
    fetchSpy.mockResolvedValue(makeOkResponse({ items: [], total: 0, limit: 50, offset: 0 }))
    const client = createClient(INSTANCE)
    await client.churchVideos("abc", { has_transcript: true })
    const [url] = fetchSpy.mock.calls[0]
    expect(url).toContain("/v1/admin/churches/abc/videos")
    expect(url).toContain("has_transcript=true")
  })

  // ── Requests ───────────────────────────────────────────────────────────────

  it("requestsList sends GET /v1/admin/requests", async () => {
    fetchSpy.mockResolvedValue(makeOkResponse({ requests: [], total: 0, limit: 20, offset: 0 }))
    const client = createClient(INSTANCE)
    const result = await client.requestsList({ status: "awaiting_approval" })
    expect(result.requests).toEqual([])
    const [url] = fetchSpy.mock.calls[0]
    expect(url).toContain("status=awaiting_approval")
  })

  it("requestApprove sends POST /v1/admin/requests/:id/approve with no body", async () => {
    fetchSpy.mockResolvedValue(makeOkResponse({ id: "req-1", status: "approved" }))
    const client = createClient(INSTANCE)
    const result = await client.requestApprove("req-1")
    expect(result.status).toBe("approved")
    const [url, init] = fetchSpy.mock.calls[0]
    expect(url).toContain("/v1/admin/requests/req-1/approve")
    expect((init as RequestInit).method).toBe("POST")
  })

  it("requestDeny sends POST /v1/admin/requests/:id/deny with note in body", async () => {
    fetchSpy.mockResolvedValue(makeOkResponse({ id: "req-1", status: "denied" }))
    const client = createClient(INSTANCE)
    await client.requestDeny("req-1", "Spam channel")
    const [url, init] = fetchSpy.mock.calls[0]
    expect(url).toContain("/v1/admin/requests/req-1/deny")
    expect((init as RequestInit).method).toBe("POST")
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({ note: "Spam channel" })
  })

  it("requestRetry sends POST /v1/admin/requests/:id/retry with no body", async () => {
    fetchSpy.mockResolvedValue(makeOkResponse({ id: "req-1", status: "received" }))
    const client = createClient(INSTANCE)
    const result = await client.requestRetry("req-1")
    expect(result.status).toBe("received")
    const [url, init] = fetchSpy.mock.calls[0]
    expect(url).toContain("/v1/admin/requests/req-1/retry")
    expect((init as RequestInit).method).toBe("POST")
    expect((init as RequestInit).body).toBeUndefined()
  })

  // ── Channels ───────────────────────────────────────────────────────────────

  it("channelAdd sends POST /v1/admin/channels with body", async () => {
    const channel = {
      id: "ch-1",
      youtube_channel_id: "UC123",
      title: "Test",
      ingested_at: "2024-01-01T00:00:00Z",
    }
    fetchSpy.mockResolvedValue(makeOkResponse(channel))
    const client = createClient(INSTANCE)
    const result = await client.channelAdd({ churchSlug: "grace", handle: "@grace" })
    expect(result.youtube_channel_id).toBe("UC123")
    const [url, init] = fetchSpy.mock.calls[0]
    expect(url).toContain("/v1/admin/channels")
    expect((init as RequestInit).method).toBe("POST")
    expect(JSON.parse((init as RequestInit).body as string)).toMatchObject({
      churchSlug: "grace",
      handle: "@grace",
    })
  })

  it("channelRefresh sends POST /v1/admin/ingest/refresh with churchSlug query param", async () => {
    fetchSpy.mockResolvedValue(makeOkResponse({ channels: [] }))
    const client = createClient(INSTANCE)
    await client.channelRefresh({ churchSlug: "grace", force: true })
    const [url, init] = fetchSpy.mock.calls[0]
    expect(url).toContain("/v1/admin/ingest/refresh")
    expect(url).toContain("churchSlug=grace")
    expect(url).toContain("force=true")
    expect((init as RequestInit).method).toBe("POST")
  })

  it("channelViewStats sends POST /v1/admin/ingest/view-stats with churchSlug body", async () => {
    fetchSpy.mockResolvedValue(
      makeOkResponse({ channelCount: 1, playlistCount: 2, videoCount: 10, fetchedFromApi: 10 }),
    )
    const client = createClient(INSTANCE)
    const result = await client.channelViewStats("grace")
    expect(result.channelCount).toBe(1)
    const [url, init] = fetchSpy.mock.calls[0]
    expect(url).toContain("/v1/admin/ingest/view-stats")
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({ churchSlug: "grace" })
  })

  // ── Audit ──────────────────────────────────────────────────────────────────

  it("auditList sends GET /v1/admin/audit", async () => {
    fetchSpy.mockResolvedValue(makeOkResponse({ items: [], total: 0 }))
    const client = createClient(INSTANCE)
    const result = await client.auditList({ action: "request.approve" })
    expect(result.items).toEqual([])
    const [url] = fetchSpy.mock.calls[0]
    expect(url).toContain("/v1/admin/audit")
    expect(url).toContain("action=request.approve")
  })
})
