import type {
  HomeResponse,
  SearchResponse,
  Topic,
  TopicVideos,
  TranscriptResponse,
  VideoDetailResponse,
} from "@sermon-search/types"

function apiBase(): string {
  return process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001"
}

export interface SearchParams {
  q: string
  playlist?: string
  topic?: string
  limit?: number
  offset?: number
}

export async function fetchSearch(params: SearchParams): Promise<SearchResponse> {
  try {
    const sp = new URLSearchParams({ q: params.q })
    if (params.playlist) sp.set("playlist", params.playlist)
    if (params.topic) sp.set("topic", params.topic)
    if (params.limit != null) sp.set("limit", String(params.limit))
    if (params.offset != null) sp.set("offset", String(params.offset))
    const res = await fetch(`${apiBase()}/v1/search?${sp.toString()}`)
    if (!res.ok) return { results: [], total: 0, took_ms: 0 }
    return res.json() as Promise<SearchResponse>
  } catch {
    return { results: [], total: 0, took_ms: 0 }
  }
}

export async function fetchHome(): Promise<HomeResponse> {
  try {
    const res = await fetch(`${apiBase()}/v1/home`, {
      next: { revalidate: 60 },
    })
    if (!res.ok) return { recent: [], top_playlists: [] }
    return res.json() as Promise<HomeResponse>
  } catch {
    return { recent: [], top_playlists: [] }
  }
}

export async function fetchVideo(id: string): Promise<VideoDetailResponse | null> {
  try {
    const res = await fetch(`${apiBase()}/v1/videos/${id}`, {
      next: { revalidate: 60 },
    })
    if (!res.ok) return null
    return res.json() as Promise<VideoDetailResponse>
  } catch {
    return null
  }
}

export async function fetchTranscript(id: string): Promise<TranscriptResponse | null> {
  try {
    const res = await fetch(`${apiBase()}/v1/videos/${id}/transcript`, {
      next: { revalidate: 60 },
    })
    if (!res.ok) return null
    return res.json() as Promise<TranscriptResponse>
  } catch {
    return null
  }
}

export async function fetchVideoSearch(id: string, q: string): Promise<SearchResponse | null> {
  try {
    const url = new URL(`${apiBase()}/v1/videos/${id}/search`)
    url.searchParams.set("q", q)
    const res = await fetch(url.toString())
    if (!res.ok) return null
    return res.json() as Promise<SearchResponse>
  } catch {
    return null
  }
}

export async function fetchTopics(): Promise<Topic[]> {
  try {
    const res = await fetch(`${apiBase()}/v1/topics`, { next: { revalidate: 60 } })
    if (!res.ok) return []
    const data = (await res.json()) as { topics: Topic[] }
    return data.topics
  } catch {
    return []
  }
}

export async function fetchTopic(
  slug: string,
  opts: { limit?: number; offset?: number } = {},
): Promise<TopicVideos | null> {
  try {
    const sp = new URLSearchParams()
    if (opts.limit != null) sp.set("limit", String(opts.limit))
    if (opts.offset != null) sp.set("offset", String(opts.offset))
    const qs = sp.toString()
    const res = await fetch(`${apiBase()}/v1/topics/${slug}${qs ? `?${qs}` : ""}`, {
      next: { revalidate: 60 },
    })
    if (!res.ok) return null
    return res.json() as Promise<TopicVideos>
  } catch {
    return null
  }
}
