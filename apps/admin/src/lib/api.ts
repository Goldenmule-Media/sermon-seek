import { cookies } from "next/headers"

const ADMIN_API_URL = process.env.ADMIN_API_URL ?? "http://localhost:3001"

export async function adminApiFetch(path: string, init?: RequestInit): Promise<Response> {
  const cookieHeader = (await cookies()).toString()
  return fetch(`${ADMIN_API_URL}${path}`, {
    ...init,
    cache: "no-store",
    headers: {
      ...(init?.headers as Record<string, string> | undefined),
      cookie: cookieHeader,
    },
  })
}

// --- Types ---

export type IngestionRequestStatus =
  | "received"
  | "running"
  | "awaiting_approval"
  | "approved"
  | "denied"
  | "failed"
  | "complete"

export interface PlaylistFilters {
  mode: "none" | "include" | "exclude"
  playlist_ids: string[]
}

export interface AdminRequestSummary {
  id: string
  user_id: string
  display_name: string | null
  requested_slug: string
  status: IngestionRequestStatus
  ingest_mode: "full" | "incremental"
  videos_discovered: number
  videos_ingested: number
  tokens_ingested: number
  tokens_cap: number
  search_url: string | null
  limit_reached: boolean
  created_at: string
  playlist_filters: PlaylistFilters
}

export interface AdminRequestDetail extends AdminRequestSummary {
  requested_name: string
  youtube_handle_or_url: string
  contact_email: string
  admin_note: string | null
  updated_at: string
  church_slug: string | null
  church_status: string | null
  youtube_channel_id: string | null
  channel_title: string | null
  discovered_playlists: {
    id: string
    title: string
    slug: string
    video_count: number | null
  }[]
}

export interface AdminRequestsListResponse {
  requests: AdminRequestSummary[]
  total: number
  limit: number
  offset: number
}

// --- Fetch helpers ---

export async function fetchAdminRequests(query: {
  status?: string
  user_id?: string
  limit?: number
  offset?: number
}): Promise<AdminRequestsListResponse | null> {
  const sp = new URLSearchParams()
  if (query.status) sp.set("status", query.status)
  if (query.user_id) sp.set("user_id", query.user_id)
  sp.set("limit", String(query.limit ?? 20))
  sp.set("offset", String(query.offset ?? 0))

  const res = await adminApiFetch(`/v1/admin/requests?${sp.toString()}`)
  if (!res.ok) return null
  return res.json() as Promise<AdminRequestsListResponse>
}

export async function fetchAdminRequest(id: string): Promise<AdminRequestDetail | null> {
  const res = await adminApiFetch(`/v1/admin/requests/${id}`)
  if (res.status === 404) return null
  if (!res.ok) return null
  return res.json() as Promise<AdminRequestDetail>
}

export async function approveAdminRequest(
  id: string,
): Promise<{ ok: true } | { ok: false; error: string; httpStatus: number }> {
  const res = await adminApiFetch(`/v1/admin/requests/${id}/approve`, { method: "POST" })
  if (res.ok) return { ok: true }
  const body = (await res.json().catch(() => ({ error: "unknown" }))) as { error: string }
  return { ok: false, error: body.error ?? "unknown", httpStatus: res.status }
}

export async function denyAdminRequest(
  id: string,
  note: string,
): Promise<{ ok: true } | { ok: false; error: string; httpStatus: number }> {
  const res = await adminApiFetch(`/v1/admin/requests/${id}/deny`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ note }),
  })
  if (res.ok) return { ok: true }
  const body = (await res.json().catch(() => ({ error: "unknown" }))) as { error: string }
  return { ok: false, error: body.error ?? "unknown", httpStatus: res.status }
}

export async function retryAdminRequest(
  id: string,
): Promise<{ ok: true } | { ok: false; error: string; httpStatus: number }> {
  const res = await adminApiFetch(`/v1/admin/requests/${id}/retry`, { method: "POST" })
  if (res.ok) return { ok: true }
  const body = (await res.json().catch(() => ({ error: "unknown" }))) as { error: string }
  return { ok: false, error: body.error ?? "unknown", httpStatus: res.status }
}
