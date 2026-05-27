import { cookies } from "next/headers"
import { adminApiUrl } from "./env"

export async function adminFetch(path: string, init?: RequestInit): Promise<Response> {
  const cookieStore = await cookies()
  return fetch(`${adminApiUrl()}/v1${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      cookie: cookieStore.toString(),
      ...(init?.headers as Record<string, string>),
    },
  })
}

export interface ChurchSummary {
  id: string
  slug: string
  name: string
  status: "pending" | "active" | "suspended" | "denied"
  channel_count: number
  video_count: number
  created_at: string
}

export interface ChurchAlias {
  id: string
  slug: string
  created_at: string
  expires_at: string | null
}

export interface ChurchChannel {
  id: string
  youtube_channel_id: string
  title: string
  ingested_at: string
}

export interface ChurchDetail {
  id: string
  slug: string
  name: string
  status: "pending" | "active" | "suspended" | "denied"
  youtube_channel_id: string | null
  created_at: string
  channel_count: number
  video_count: number
  aliases: ChurchAlias[]
  channels: ChurchChannel[]
}

export async function getChurches(params: {
  slug_prefix?: string
  limit: number
  offset: number
}): Promise<{ items: ChurchSummary[]; total: number }> {
  const sp = new URLSearchParams({
    limit: String(params.limit),
    offset: String(params.offset),
  })
  if (params.slug_prefix) sp.set("slug_prefix", params.slug_prefix)

  const res = await adminFetch(`/admin/churches?${sp.toString()}`)
  if (!res.ok) throw new Error(`GET /admin/churches failed: ${res.status}`)
  return res.json() as Promise<{ items: ChurchSummary[]; total: number }>
}

export async function getChurch(id: string): Promise<ChurchDetail | null> {
  const res = await adminFetch(`/admin/churches/${encodeURIComponent(id)}`)
  if (res.status === 404) return null
  if (!res.ok) throw new Error(`GET /admin/churches/:id failed: ${res.status}`)
  return res.json() as Promise<ChurchDetail>
}

export interface AdminVideo {
  id: string
  youtube_id: string
  title: string
  published_at: string | null
  has_transcript: boolean
  last_retranscribed_at: string | null
}

export async function getChurchVideos(
  churchId: string,
  params: { limit: number; offset: number; has_transcript?: boolean },
): Promise<{ items: AdminVideo[]; total: number; limit: number; offset: number }> {
  const sp = new URLSearchParams({
    limit: String(params.limit),
    offset: String(params.offset),
  })
  if (params.has_transcript !== undefined) {
    sp.set("has_transcript", String(params.has_transcript))
  }
  const res = await adminFetch(
    `/admin/churches/${encodeURIComponent(churchId)}/videos?${sp.toString()}`,
  )
  if (!res.ok) throw new Error(`GET /admin/churches/:id/videos failed: ${res.status}`)
  return res.json() as Promise<{
    items: AdminVideo[]
    total: number
    limit: number
    offset: number
  }>
}
