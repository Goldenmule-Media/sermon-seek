import type {
  ChannelsListResponse,
  PlaylistItemsListResponse,
  PlaylistsListResponse,
  VideosListResponse,
} from "./types.js"

export type FetchLike = (
  url: string,
  init?: { method?: string; headers?: Record<string, string> },
) => Promise<{
  ok: boolean
  status: number
  text: () => Promise<string>
}>

export interface YoutubeClientOptions {
  apiKey: string
  fetch?: FetchLike
  baseUrl?: string
  maxRetries?: number
  retryDelayMs?: number
  sleep?: (ms: number) => Promise<void>
}

export class YoutubeApiError extends Error {
  readonly status: number
  readonly body: string
  constructor(status: number, body: string, message: string) {
    super(message)
    this.name = "YoutubeApiError"
    this.status = status
    this.body = body
  }
}

const DEFAULT_BASE = "https://www.googleapis.com/youtube/v3"
const VIDEO_BATCH_LIMIT = 50

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export class YoutubeClient {
  private readonly apiKey: string
  private readonly fetchImpl: FetchLike
  private readonly baseUrl: string
  private readonly maxRetries: number
  private readonly retryDelayMs: number
  private readonly sleep: (ms: number) => Promise<void>

  constructor(opts: YoutubeClientOptions) {
    if (!opts.apiKey || opts.apiKey.length === 0) {
      throw new Error("YoutubeClient: apiKey is required")
    }
    this.apiKey = opts.apiKey
    this.fetchImpl = opts.fetch ?? (globalThis.fetch as unknown as FetchLike)
    if (!this.fetchImpl) {
      throw new Error("YoutubeClient: fetch implementation not available")
    }
    this.baseUrl = opts.baseUrl ?? DEFAULT_BASE
    this.maxRetries = opts.maxRetries ?? 2
    this.retryDelayMs = opts.retryDelayMs ?? 500
    this.sleep = opts.sleep ?? defaultSleep
  }

  private buildUrl(path: string, params: Record<string, string | undefined>): string {
    const usp = new URLSearchParams()
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined && v !== "") usp.set(k, v)
    }
    usp.set("key", this.apiKey)
    return `${this.baseUrl}/${path}?${usp.toString()}`
  }

  private async getJson<T>(path: string, params: Record<string, string | undefined>): Promise<T> {
    const url = this.buildUrl(path, params)
    let attempt = 0
    let lastError: YoutubeApiError | null = null

    while (attempt <= this.maxRetries) {
      const response = await this.fetchImpl(url, { method: "GET" })
      if (response.ok) {
        const text = await response.text()
        return JSON.parse(text) as T
      }
      const body = await response.text()
      lastError = new YoutubeApiError(
        response.status,
        body,
        `YouTube API ${path} failed: ${response.status}`,
      )
      const retriable = response.status === 429 || response.status >= 500
      if (!retriable || attempt === this.maxRetries) {
        throw lastError
      }
      attempt += 1
      await this.sleep(this.retryDelayMs * 2 ** (attempt - 1))
    }

    throw lastError ?? new Error("YoutubeClient: unreachable")
  }

  async listChannelsByHandle(handle: string): Promise<ChannelsListResponse> {
    const bare = handle.startsWith("@") ? handle.slice(1) : handle
    return this.getJson<ChannelsListResponse>("channels", {
      part: "snippet,contentDetails",
      forHandle: `@${bare}`,
    })
  }

  async listChannelsByUsername(username: string): Promise<ChannelsListResponse> {
    return this.getJson<ChannelsListResponse>("channels", {
      part: "snippet,contentDetails",
      forUsername: username,
    })
  }

  async listChannelsById(id: string): Promise<ChannelsListResponse> {
    return this.getJson<ChannelsListResponse>("channels", {
      part: "snippet,contentDetails",
      id,
    })
  }

  async listPlaylists(channelId: string, pageToken?: string): Promise<PlaylistsListResponse> {
    return this.getJson<PlaylistsListResponse>("playlists", {
      part: "snippet,contentDetails",
      channelId,
      maxResults: "50",
      pageToken,
    })
  }

  async listPlaylistsById(playlistId: string): Promise<PlaylistsListResponse> {
    return this.getJson<PlaylistsListResponse>("playlists", {
      part: "snippet,contentDetails",
      id: playlistId,
    })
  }

  async listPlaylistItems(
    playlistId: string,
    pageToken?: string,
  ): Promise<PlaylistItemsListResponse> {
    return this.getJson<PlaylistItemsListResponse>("playlistItems", {
      part: "snippet,contentDetails",
      playlistId,
      maxResults: "50",
      pageToken,
    })
  }

  async listVideos(ids: readonly string[]): Promise<VideosListResponse> {
    if (ids.length === 0) {
      return { items: [] }
    }
    const batches: string[][] = []
    for (let i = 0; i < ids.length; i += VIDEO_BATCH_LIMIT) {
      batches.push(ids.slice(i, i + VIDEO_BATCH_LIMIT))
    }
    const merged: VideosListResponse = { items: [] }
    for (const batch of batches) {
      const response = await this.getJson<VideosListResponse>("videos", {
        part: "snippet,contentDetails,statistics",
        id: batch.join(","),
      })
      if (response.items) {
        merged.items = (merged.items ?? []).concat(response.items)
      }
    }
    return merged
  }
}
