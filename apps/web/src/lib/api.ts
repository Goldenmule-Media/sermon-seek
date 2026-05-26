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

export function apiBase(): string {
  return process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001"
}

function churchHeaders(church: string): HeadersInit {
  return { "X-Church-Slug": church }
}

function churchUrl(church: string, path: string): string {
  return `${apiBase()}/v1/${encodeURIComponent(church)}${path}`
}

export interface SearchParams {
  church: string
  q?: string
  ref?: string
  playlist?: string
  from?: string
  to?: string
  limit?: number
  offset?: number
}

export async function fetchSearch(
  params: SearchParams,
): Promise<SearchResponse | { error: string }> {
  const { church, ...rest } = params
  try {
    const sp = new URLSearchParams()
    if (rest.ref) {
      sp.set("ref", rest.ref)
    } else if (rest.q) {
      sp.set("q", rest.q)
    }
    if (rest.playlist) sp.set("playlist", rest.playlist)
    if (rest.from) sp.set("from", rest.from)
    if (rest.to) sp.set("to", rest.to)
    if (rest.limit != null) sp.set("limit", String(rest.limit))
    if (rest.offset != null) sp.set("offset", String(rest.offset))
    const res = await fetch(`${churchUrl(church, "/search")}?${sp.toString()}`, {
      headers: churchHeaders(church),
    })
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

export async function fetchHome(church: string): Promise<HomeResponse | null> {
  try {
    const res = await fetch(churchUrl(church, "/home"), {
      headers: churchHeaders(church),
      next: { revalidate: 60 },
    })
    if (!res.ok) return null
    return res.json() as Promise<HomeResponse>
  } catch {
    return null
  }
}

export async function fetchVideo(church: string, id: string): Promise<VideoDetailResponse | null> {
  try {
    const res = await fetch(churchUrl(church, `/videos/${id}`), {
      headers: churchHeaders(church),
      next: { revalidate: 60 },
    })
    if (!res.ok) return null
    return res.json() as Promise<VideoDetailResponse>
  } catch {
    return null
  }
}

export async function fetchTranscript(
  church: string,
  id: string,
): Promise<TranscriptResponse | null> {
  try {
    const res = await fetch(churchUrl(church, `/videos/${id}/transcript`), {
      headers: churchHeaders(church),
      next: { revalidate: 60 },
    })
    if (!res.ok) return null
    return res.json() as Promise<TranscriptResponse>
  } catch {
    return null
  }
}

export async function fetchVideoSearch(
  church: string,
  id: string,
  q: string,
): Promise<SearchResponse | null> {
  try {
    const url = new URL(churchUrl(church, `/videos/${id}/search`))
    url.searchParams.set("q", q)
    const res = await fetch(url.toString(), { headers: churchHeaders(church) })
    if (!res.ok) return null
    return res.json() as Promise<SearchResponse>
  } catch {
    return null
  }
}

export async function fetchTopics(church: string): Promise<Topic[]> {
  try {
    const res = await fetch(churchUrl(church, "/topics"), {
      headers: churchHeaders(church),
      next: { revalidate: 60 },
    })
    if (!res.ok) return []
    const data = (await res.json()) as { topics: Topic[] }
    return data.topics
  } catch {
    return []
  }
}

export async function fetchRelated(
  church: string,
  id: string,
  limit?: number,
): Promise<RelatedVideo[]> {
  try {
    const sp = new URLSearchParams()
    if (limit != null) sp.set("limit", String(limit))
    const qs = sp.toString()
    const res = await fetch(`${churchUrl(church, `/videos/${id}/related`)}${qs ? `?${qs}` : ""}`, {
      headers: churchHeaders(church),
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
  church: string,
  slug: string,
  opts: { limit?: number; offset?: number } = {},
): Promise<TopicVideos | null> {
  try {
    const sp = new URLSearchParams()
    if (opts.limit != null) sp.set("limit", String(opts.limit))
    if (opts.offset != null) sp.set("offset", String(opts.offset))
    const qs = sp.toString()
    const res = await fetch(`${churchUrl(church, `/topics/${slug}`)}${qs ? `?${qs}` : ""}`, {
      headers: churchHeaders(church),
      next: { revalidate: 60 },
    })
    if (!res.ok) return null
    return res.json() as Promise<TopicVideos>
  } catch {
    return null
  }
}

export async function fetchPlaylists(church: string): Promise<PlaylistWithStats[]> {
  try {
    const res = await fetch(churchUrl(church, "/playlists"), {
      headers: churchHeaders(church),
      next: { revalidate: 60 },
    })
    if (!res.ok) return []
    const data = (await res.json()) as { playlists: PlaylistWithStats[] }
    return data.playlists
  } catch {
    return []
  }
}

export async function fetchPlaylist(
  church: string,
  slug: string,
  opts: { limit?: number; offset?: number } = {},
): Promise<PlaylistVideos | null> {
  try {
    const sp = new URLSearchParams()
    if (opts.limit != null) sp.set("limit", String(opts.limit))
    if (opts.offset != null) sp.set("offset", String(opts.offset))
    const qs = sp.toString()
    const res = await fetch(
      `${churchUrl(church, `/playlists/${slug}/videos`)}${qs ? `?${qs}` : ""}`,
      { headers: churchHeaders(church), next: { revalidate: 60 } },
    )
    if (!res.ok) return null
    return res.json() as Promise<PlaylistVideos>
  } catch {
    return null
  }
}
