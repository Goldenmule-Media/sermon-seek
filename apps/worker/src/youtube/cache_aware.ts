import * as fsp from "node:fs/promises"
import { cache } from "../cache/cache.js"
import type { YoutubeClient } from "./client.js"
import type { YoutubeChannel, YoutubePlaylist, YoutubePlaylistItem, YoutubeVideo } from "./types.js"

const PLAYLISTS_TTL_MS = 24 * 60 * 60 * 1000

function channelMetadataParts(channelId: string): string[] {
  return ["channels", channelId, "metadata.json"]
}

function channelPlaylistsParts(channelId: string): string[] {
  return ["channels", channelId, "playlists.json"]
}

function playlistItemsParts(channelId: string, playlistId: string): string[] {
  return ["channels", channelId, "playlists", playlistId, "items.json"]
}

function videoMetadataParts(videoId: string): string[] {
  return ["videos", videoId, "metadata.json"]
}

async function fileMtimeMs(parts: string[]): Promise<number | null> {
  try {
    const stat = await fsp.stat(cache.path(parts))
    return stat.mtimeMs
  } catch (err) {
    if (err instanceof Error && "code" in err && (err as NodeJS.ErrnoException).code === "ENOENT") {
      return null
    }
    throw err
  }
}

export interface CachedChannelResult {
  channel: YoutubeChannel
  fromCache: boolean
}

export async function getChannelMetadata(
  client: YoutubeClient,
  channelId: string,
): Promise<CachedChannelResult> {
  const cached = await cache.readJson<YoutubeChannel>(channelMetadataParts(channelId))
  if (cached !== null) {
    return { channel: cached, fromCache: true }
  }
  const response = await client.listChannelsById(channelId)
  const channel = response.items?.[0]
  if (!channel) {
    throw new Error(`Channel not found: ${channelId}`)
  }
  await cache.writeJsonAtomic(channelMetadataParts(channelId), channel)
  return { channel, fromCache: false }
}

export interface CachedPlaylistResult {
  playlist: YoutubePlaylist
  fromCache: boolean
}

export async function getPlaylistById(
  client: YoutubeClient,
  playlistId: string,
): Promise<CachedPlaylistResult> {
  const parts = ["playlists", playlistId, "metadata.json"]
  const cached = await cache.readJson<YoutubePlaylist>(parts)
  if (cached !== null) {
    return { playlist: cached, fromCache: true }
  }
  const response = await client.listPlaylistsById(playlistId)
  const playlist = response.items?.[0]
  if (!playlist) {
    throw new Error(`Playlist not found: ${playlistId}`)
  }
  await cache.writeJsonAtomic(parts, playlist)
  return { playlist, fromCache: false }
}

export interface CachedPlaylistsResult {
  playlists: YoutubePlaylist[]
  fromCache: boolean
}

export async function getChannelPlaylists(
  client: YoutubeClient,
  channelId: string,
  options: { ttlMs?: number; now?: () => number } = {},
): Promise<CachedPlaylistsResult> {
  const ttl = options.ttlMs ?? PLAYLISTS_TTL_MS
  const now = options.now ?? (() => Date.now())
  const parts = channelPlaylistsParts(channelId)

  const mtime = await fileMtimeMs(parts)
  if (mtime !== null && now() - mtime < ttl) {
    const cached = await cache.readJson<YoutubePlaylist[]>(parts)
    if (cached !== null) {
      return { playlists: cached, fromCache: true }
    }
  }

  const all: YoutubePlaylist[] = []
  let pageToken: string | undefined
  do {
    const page = await client.listPlaylists(channelId, pageToken)
    if (page.items) all.push(...page.items)
    pageToken = page.nextPageToken
  } while (pageToken)

  await cache.writeJsonAtomic(parts, all)
  return { playlists: all, fromCache: false }
}

export interface CachedPlaylistItemsResult {
  items: YoutubePlaylistItem[]
  hadNewItems: boolean
}

export async function getPlaylistItems(
  client: YoutubeClient,
  channelId: string,
  playlistId: string,
): Promise<CachedPlaylistItemsResult> {
  const parts = playlistItemsParts(channelId, playlistId)
  const cached = (await cache.readJson<YoutubePlaylistItem[]>(parts)) ?? []
  const knownIds = new Set<string>()
  for (const item of cached) {
    const id = item.contentDetails?.videoId ?? item.snippet?.resourceId?.videoId
    if (id) knownIds.add(id)
  }

  const newPagesPrepended: YoutubePlaylistItem[] = []
  let pageToken: string | undefined
  let stopped = false
  do {
    const page = await client.listPlaylistItems(playlistId, pageToken)
    const items = page.items ?? []
    for (const item of items) {
      const id = item.contentDetails?.videoId ?? item.snippet?.resourceId?.videoId
      if (id && knownIds.has(id)) {
        stopped = true
        break
      }
      newPagesPrepended.push(item)
    }
    if (stopped) break
    pageToken = page.nextPageToken
  } while (pageToken)

  if (newPagesPrepended.length > 0) {
    await cache.mergePrependedItems(parts, newPagesPrepended, "id")
  }

  const merged = (await cache.readJson<YoutubePlaylistItem[]>(parts)) ?? []
  return {
    items: merged,
    hadNewItems: newPagesPrepended.length > 0,
  }
}

export interface CachedVideoBatchResult {
  videos: Map<string, YoutubeVideo>
  fetchedIds: string[]
}

export interface GetVideosBatchedOptions {
  // Bypass the read-side cache and call the API for every requested id.
  // The view-stats job needs this because cached metadata holds stale
  // statistics.viewCount; the API is still write-through so the cache
  // stays in lockstep with the DB. playlists.list / playlistItems.list
  // remain cache-served because playlist membership changes infrequently.
  force?: boolean
}

export async function getVideosBatched(
  client: YoutubeClient,
  ids: readonly string[],
  options: GetVideosBatchedOptions = {},
): Promise<CachedVideoBatchResult> {
  const videos = new Map<string, YoutubeVideo>()
  const toFetch: string[] = []
  if (options.force) {
    toFetch.push(...ids)
  } else {
    for (const id of ids) {
      const cached = await cache.readJson<YoutubeVideo>(videoMetadataParts(id))
      if (cached !== null) {
        videos.set(id, cached)
      } else {
        toFetch.push(id)
      }
    }
  }

  if (toFetch.length === 0) {
    return { videos, fetchedIds: [] }
  }

  const response = await client.listVideos(toFetch)
  const fetched: string[] = []
  for (const video of response.items ?? []) {
    await cache.writeJsonAtomic(videoMetadataParts(video.id), video)
    videos.set(video.id, video)
    fetched.push(video.id)
  }
  return { videos, fetchedIds: fetched }
}
