import { describe, expect, it } from "vitest"
import { type FetchLike, YoutubeApiError, YoutubeClient } from "./client.js"

interface CallRecord {
  url: string
}

function getCall(calls: readonly CallRecord[], index: number): CallRecord {
  const call = calls[index]
  if (!call) throw new Error(`No call at index ${index}`)
  return call
}

function makeFetch(handlers: Array<{ status: number; body: unknown }>): {
  fetch: FetchLike
  calls: CallRecord[]
} {
  const calls: CallRecord[] = []
  let idx = 0
  const fetch: FetchLike = async (url) => {
    calls.push({ url })
    const handler = handlers[Math.min(idx, handlers.length - 1)]
    idx += 1
    if (!handler) {
      throw new Error("no handler configured")
    }
    return {
      ok: handler.status >= 200 && handler.status < 300,
      status: handler.status,
      text: async () =>
        typeof handler.body === "string" ? handler.body : JSON.stringify(handler.body),
    }
  }
  return { fetch, calls }
}

describe("YoutubeClient.buildUrl", () => {
  it("appends api key and parts to channels.list?forHandle", async () => {
    const { fetch, calls } = makeFetch([{ status: 200, body: { items: [] } }])
    const client = new YoutubeClient({ apiKey: "test-key", fetch })
    await client.listChannelsByHandle("@JubileeChurchSTL")
    expect(calls).toHaveLength(1)
    const url = new URL(getCall(calls, 0).url)
    expect(url.pathname).toContain("/youtube/v3/channels")
    expect(url.searchParams.get("forHandle")).toBe("@JubileeChurchSTL")
    expect(url.searchParams.get("part")).toContain("snippet")
    expect(url.searchParams.get("key")).toBe("test-key")
  })

  it("normalizes bare handle by adding @", async () => {
    const { fetch, calls } = makeFetch([{ status: 200, body: { items: [] } }])
    const client = new YoutubeClient({ apiKey: "k", fetch })
    await client.listChannelsByHandle("JubileeChurchSTL")
    const url = new URL(getCall(calls, 0).url)
    expect(url.searchParams.get("forHandle")).toBe("@JubileeChurchSTL")
  })

  it("sends pageToken when provided", async () => {
    const { fetch, calls } = makeFetch([{ status: 200, body: { items: [] } }])
    const client = new YoutubeClient({ apiKey: "k", fetch })
    await client.listPlaylistItems("PL123", "page-2")
    const url = new URL(getCall(calls, 0).url)
    expect(url.searchParams.get("pageToken")).toBe("page-2")
    expect(url.searchParams.get("playlistId")).toBe("PL123")
  })
})

describe("YoutubeClient.listVideos", () => {
  it("returns empty when ids is empty without HTTP call", async () => {
    const { fetch, calls } = makeFetch([{ status: 200, body: { items: [] } }])
    const client = new YoutubeClient({ apiKey: "k", fetch })
    const result = await client.listVideos([])
    expect(result.items).toEqual([])
    expect(calls).toHaveLength(0)
  })

  it("batches >50 IDs into multiple comma-joined calls and merges results", async () => {
    const ids = Array.from({ length: 75 }, (_, i) => `v${i}`)
    const { fetch, calls } = makeFetch([
      { status: 200, body: { items: ids.slice(0, 50).map((id) => ({ id })) } },
      { status: 200, body: { items: ids.slice(50).map((id) => ({ id })) } },
    ])
    const client = new YoutubeClient({ apiKey: "k", fetch })
    const result = await client.listVideos(ids)
    expect(calls).toHaveLength(2)
    const firstIds = (new URL(getCall(calls, 0).url).searchParams.get("id") ?? "").split(",")
    const secondIds = (new URL(getCall(calls, 1).url).searchParams.get("id") ?? "").split(",")
    expect(firstIds).toHaveLength(50)
    expect(secondIds).toHaveLength(25)
    expect(result.items).toHaveLength(75)
  })
})

describe("YoutubeClient error handling", () => {
  it("surfaces non-2xx, non-retriable errors as YoutubeApiError", async () => {
    const { fetch } = makeFetch([{ status: 403, body: "forbidden" }])
    const client = new YoutubeClient({ apiKey: "k", fetch, maxRetries: 0, sleep: async () => {} })
    await expect(client.listChannelsByHandle("@x")).rejects.toBeInstanceOf(YoutubeApiError)
  })

  it("retries on 429 then succeeds", async () => {
    const { fetch, calls } = makeFetch([
      { status: 429, body: "rate limited" },
      { status: 200, body: { items: [] } },
    ])
    const client = new YoutubeClient({ apiKey: "k", fetch, maxRetries: 2, sleep: async () => {} })
    const result = await client.listChannelsByHandle("@x")
    expect(result.items).toEqual([])
    expect(calls).toHaveLength(2)
  })

  it("retries on 503 then succeeds", async () => {
    const { fetch, calls } = makeFetch([
      { status: 503, body: "unavailable" },
      { status: 200, body: { items: [{ id: "UC1" }] } },
    ])
    const client = new YoutubeClient({ apiKey: "k", fetch, maxRetries: 2, sleep: async () => {} })
    const result = await client.listChannelsByHandle("@x")
    expect(result.items).toHaveLength(1)
    expect(calls).toHaveLength(2)
  })
})
