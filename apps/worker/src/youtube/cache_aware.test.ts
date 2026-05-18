import * as fsp from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest"
import type { FetchLike } from "./client.js"

const TMP_ROOT = join(tmpdir(), `sermon-cache-aware-${process.pid}-${Date.now()}`)
const ORIGINAL_CACHE_DIR = process.env.CACHE_DIR
process.env.CACHE_DIR = TMP_ROOT

const cacheAwareModule = await import("./cache_aware.js")
const clientModule = await import("./client.js")
const { getChannelMetadata, getChannelPlaylists, getPlaylistItems, getVideosBatched } =
  cacheAwareModule
const { YoutubeClient } = clientModule

beforeAll(async () => {
  await fsp.mkdir(TMP_ROOT, { recursive: true })
})

afterAll(async () => {
  await fsp.rm(TMP_ROOT, { recursive: true, force: true })
  if (ORIGINAL_CACHE_DIR === undefined) {
    process.env.CACHE_DIR = undefined
  } else {
    process.env.CACHE_DIR = ORIGINAL_CACHE_DIR
  }
})

beforeEach(async () => {
  for (const entry of await fsp.readdir(TMP_ROOT)) {
    await fsp.rm(join(TMP_ROOT, entry), { recursive: true, force: true })
  }
})

interface FakeResponse {
  ok: boolean
  status: number
  body: unknown
}

function fakeFetch(plans: Array<(url: URL) => FakeResponse>): {
  fetch: FetchLike
  calls: string[]
} {
  const calls: string[] = []
  let idx = 0
  const fetch: FetchLike = async (rawUrl) => {
    calls.push(rawUrl)
    const plan = plans[Math.min(idx, plans.length - 1)]
    idx += 1
    if (!plan) throw new Error("no plan")
    const response = plan(new URL(rawUrl))
    return {
      ok: response.ok,
      status: response.status,
      text: async () =>
        typeof response.body === "string" ? response.body : JSON.stringify(response.body),
    }
  }
  return { fetch, calls }
}

describe("getChannelMetadata", () => {
  it("hits the network on first call and serves from cache on second", async () => {
    const { fetch, calls } = fakeFetch([
      () => ({
        ok: true,
        status: 200,
        body: { items: [{ id: "UC1", snippet: { title: "Test" } }] },
      }),
    ])
    const client = new YoutubeClient({ apiKey: "k", fetch })

    const first = await getChannelMetadata(client, "UC1")
    expect(first.fromCache).toBe(false)
    expect(first.channel.id).toBe("UC1")
    expect(calls).toHaveLength(1)

    const second = await getChannelMetadata(client, "UC1")
    expect(second.fromCache).toBe(true)
    expect(calls).toHaveLength(1)
  })
})

describe("getChannelPlaylists", () => {
  it("re-fetches when cache file is older than ttl", async () => {
    const { fetch, calls } = fakeFetch([
      () => ({ ok: true, status: 200, body: { items: [{ id: "PL1" }] } }),
      () => ({ ok: true, status: 200, body: { items: [{ id: "PL1" }, { id: "PL2" }] } }),
    ])
    const client = new YoutubeClient({ apiKey: "k", fetch })

    const first = await getChannelPlaylists(client, "UC1", { ttlMs: 1000 })
    expect(first.fromCache).toBe(false)
    expect(first.playlists).toHaveLength(1)
    expect(calls).toHaveLength(1)

    const { cache } = await import("../cache/cache.js")
    const cachePath = cache.path(["channels", "UC1", "playlists.json"])
    const stale = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
    await fsp.utimes(cachePath, stale, stale)

    const second = await getChannelPlaylists(client, "UC1", { ttlMs: 1000 })
    expect(second.fromCache).toBe(false)
    expect(second.playlists).toHaveLength(2)
    expect(calls).toHaveLength(2)
  })

  it("serves from cache when fresh", async () => {
    const { fetch, calls } = fakeFetch([
      () => ({ ok: true, status: 200, body: { items: [{ id: "PL1" }] } }),
    ])
    const client = new YoutubeClient({ apiKey: "k", fetch })

    await getChannelPlaylists(client, "UC2", { ttlMs: 60_000 })
    expect(calls).toHaveLength(1)

    const result = await getChannelPlaylists(client, "UC2", { ttlMs: 60_000 })
    expect(result.fromCache).toBe(true)
    expect(calls).toHaveLength(1)
  })
})

describe("getPlaylistItems", () => {
  it("stops paginating once it hits a known video id", async () => {
    const { fetch, calls } = fakeFetch([
      () => ({
        ok: true,
        status: 200,
        body: {
          items: [
            { id: "i1", contentDetails: { videoId: "v1" } },
            { id: "i2", contentDetails: { videoId: "v2" } },
          ],
          nextPageToken: "p2",
        },
      }),
      () => ({
        ok: true,
        status: 200,
        body: {
          items: [
            { id: "i3", contentDetails: { videoId: "v3" } },
            { id: "i_known", contentDetails: { videoId: "v_known" } },
            { id: "i4", contentDetails: { videoId: "v4" } },
          ],
        },
      }),
    ])
    const client = new YoutubeClient({ apiKey: "k", fetch })

    const { cache } = await import("../cache/cache.js")
    await cache.writeJsonAtomic(
      ["channels", "UC1", "playlists", "PL1", "items.json"],
      [{ id: "i_known", contentDetails: { videoId: "v_known" } }],
    )

    const result = await getPlaylistItems(client, "UC1", "PL1")
    expect(calls).toHaveLength(2)
    const ids = result.items.map((i) => i.id)
    expect(ids).toEqual(["i1", "i2", "i3", "i_known"])
  })
})

describe("getVideosBatched", () => {
  it("only fetches IDs that are missing from cache", async () => {
    const { cache } = await import("../cache/cache.js")
    await cache.writeJsonAtomic(["videos", "v1", "metadata.json"], {
      id: "v1",
      snippet: { title: "Cached v1" },
    })

    const { fetch, calls } = fakeFetch([
      (url) => {
        const ids = url.searchParams.get("id")?.split(",") ?? []
        return {
          ok: true,
          status: 200,
          body: { items: ids.map((id) => ({ id, snippet: { title: id } })) },
        }
      },
    ])
    const client = new YoutubeClient({ apiKey: "k", fetch })
    const result = await getVideosBatched(client, ["v1", "v2", "v3"])
    expect(calls).toHaveLength(1)
    const firstCall = calls[0] ?? ""
    const askedIds = (new URL(firstCall).searchParams.get("id") ?? "").split(",")
    expect(askedIds.sort()).toEqual(["v2", "v3"])
    expect(result.videos.size).toBe(3)
    expect(result.videos.get("v1")?.snippet?.title).toBe("Cached v1")
    expect(result.fetchedIds.sort()).toEqual(["v2", "v3"])
  })

  it("makes zero HTTP calls when everything is cached", async () => {
    const { cache } = await import("../cache/cache.js")
    await cache.writeJsonAtomic(["videos", "v1", "metadata.json"], { id: "v1" })
    await cache.writeJsonAtomic(["videos", "v2", "metadata.json"], { id: "v2" })

    const { fetch, calls } = fakeFetch([])
    const client = new YoutubeClient({ apiKey: "k", fetch })
    const result = await getVideosBatched(client, ["v1", "v2"])
    expect(calls).toHaveLength(0)
    expect(result.fetchedIds).toEqual([])
    expect(result.videos.size).toBe(2)
  })
})
