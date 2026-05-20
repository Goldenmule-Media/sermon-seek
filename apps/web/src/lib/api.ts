import type {
  HomeResponse,
  PlaylistVideos,
  PlaylistWithStats,
  RelatedVideo,
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
  q?: string
  ref?: string
  playlist?: string
  date?: string
  limit?: number
  offset?: number
}

export async function fetchSearch(
  params: SearchParams,
): Promise<SearchResponse | { error: string }> {
  try {
    const sp = new URLSearchParams()
    if (params.ref) {
      sp.set("ref", params.ref)
    } else if (params.q) {
      sp.set("q", params.q)
    }
    if (params.playlist) sp.set("playlist", params.playlist)
    if (params.date) sp.set("date", params.date)
    if (params.limit != null) sp.set("limit", String(params.limit))
    if (params.offset != null) sp.set("offset", String(params.offset))
    const res = await fetch(`${apiBase()}/v1/search?${sp.toString()}`)
    if (!res.ok) {
      try {
        const body = (await res.json()) as { message?: unknown }
        if (typeof body.message === "string") return { error: body.message }
      } catch {}
      return { error: "Search failed. Please try again." }
    }
    return res.json() as Promise<SearchResponse>
  } catch {
    return { error: "Search failed. Please try again." }
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

export async function fetchRelated(id: string, limit?: number): Promise<RelatedVideo[]> {
  try {
    const sp = new URLSearchParams()
    if (limit != null) sp.set("limit", String(limit))
    const qs = sp.toString()
    const res = await fetch(`${apiBase()}/v1/videos/${id}/related${qs ? `?${qs}` : ""}`, {
      next: { revalidate: 60 },
    })
    if (!res.ok) return []
    const data = (await res.json()) as { related: RelatedVideo[] }
    return data.related
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

export async function fetchPlaylists(): Promise<PlaylistWithStats[]> {
  try {
    const res = await fetch(`${apiBase()}/v1/playlists`, { next: { revalidate: 60 } })
    if (!res.ok) return []
    const data = (await res.json()) as { playlists: PlaylistWithStats[] }
    return data.playlists
  } catch {
    return []
  }
}

export async function fetchPlaylist(
  slug: string,
  opts: { limit?: number; offset?: number } = {},
): Promise<PlaylistVideos | null> {
  try {
    const sp = new URLSearchParams()
    if (opts.limit != null) sp.set("limit", String(opts.limit))
    if (opts.offset != null) sp.set("offset", String(opts.offset))
    const qs = sp.toString()
    const res = await fetch(`${apiBase()}/v1/playlists/${slug}/videos${qs ? `?${qs}` : ""}`, {
      next: { revalidate: 60 },
    })
    if (!res.ok) return null
    return res.json() as Promise<PlaylistVideos>
  } catch {
    return null
  }
}
