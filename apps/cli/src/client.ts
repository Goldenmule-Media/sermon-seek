import type {
  AdminLogRecord,
  AdminLogsResponse,
  ChurchStatus,
  LogLevelLabel,
} from "@sermon-search/types"
import type { ResolvedInstance } from "./instance.js"

export type { AdminLogRecord, LogLevelLabel }

export interface LogQuery {
  level?: LogLevelLabel
  since?: string
  limit?: number
}

export interface HealthWorker {
  worker_id: string
  kind: string
  last_beat_at: string
  status: string
  last_job_id: string | null
  message: string | null
  stale: boolean
}

export interface SystemRun {
  last_run_at: string | null
  last_status: string | null
}

export interface HealthResponse {
  workers: HealthWorker[]
  view_stats: SystemRun
  smoke_test: SystemRun
}

// --- Churches ---

export interface ChurchSummary {
  id: string
  slug: string
  name: string
  status: ChurchStatus
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
  status: ChurchStatus
  youtube_channel_id: string | null
  created_at: string
  channel_count: number
  video_count: number
  aliases: ChurchAlias[]
  channels: ChurchChannel[]
}

export interface ChurchesListResponse {
  items: ChurchSummary[]
  total: number
}

export interface ChurchesListQuery {
  slug_prefix?: string
  limit?: number
  offset?: number
}

// --- Requests ---

export interface RequestSummary {
  id: string
  user_id: string
  display_name: string | null
  requested_slug: string
  status: string
  videos_discovered: number
  videos_ingested: number
  tokens_ingested: number
  tokens_cap: number
  search_url: string | null
  limit_reached: boolean
  created_at: string
}

export interface RequestDetail extends RequestSummary {
  requested_name: string
  youtube_handle_or_url: string
  contact_email: string
  admin_note: string | null
  updated_at: string
  church_slug: string | null
  church_status: string | null
  youtube_channel_id: string | null
  channel_title: string | null
  playlist_filters: { mode: string; playlist_ids: string[] }
  discovered_playlists: Array<{
    id: string
    title: string
    slug: string
    video_count: number | null
  }>
}

export interface RequestsListResponse {
  requests: RequestSummary[]
  total: number
  limit: number
  offset: number
}

export interface RequestsListQuery {
  status?: string
  user_id?: string
  limit?: number
  offset?: number
}

// --- Channels ---

export interface ChannelAddBody {
  churchSlug: string
  handle?: string
  youtubeChannelId?: string
}

export interface ChannelAddResponse {
  id: string
  youtube_channel_id: string
  title: string
  ingested_at: string
}

export interface ChannelRefreshQuery {
  churchSlug: string
  force?: boolean
  channel?: string
}

export interface ChannelRefreshResponse {
  channels: Array<{ youtubeChannelId: string; playlistCount: number; videoCount: number }>
}

export interface ChannelViewStatsResponse {
  channelCount: number
  playlistCount: number
  videoCount: number
  fetchedFromApi: number
}

// --- Audit ---

export interface AuditEntry {
  id: string
  user_id: string | null
  user_display_name: string | null
  action: string
  target_type: string
  target_id: string
  payload: unknown
  created_at: string
}

export interface AuditListResponse {
  items: AuditEntry[]
  total: number
}

export interface AuditListQuery {
  limit?: number
  offset?: number
  action?: string
  target_type?: string
  user_id?: string
}

// --- Client interface ---

export interface AdminClient {
  health(): Promise<HealthResponse>
  recentLogs(q?: LogQuery): Promise<AdminLogRecord[]>
  churchesList(q?: ChurchesListQuery): Promise<ChurchesListResponse>
  churchGet(id: string): Promise<ChurchDetail>
  requestsList(q?: RequestsListQuery): Promise<RequestsListResponse>
  requestGet(id: string): Promise<RequestDetail>
  channelAdd(body: ChannelAddBody): Promise<ChannelAddResponse>
  channelRefresh(q: ChannelRefreshQuery): Promise<ChannelRefreshResponse>
  channelViewStats(churchSlug: string): Promise<ChannelViewStatsResponse>
  auditList(q?: AuditListQuery): Promise<AuditListResponse>
}

export function createClient(instance: ResolvedInstance): AdminClient {
  const { name, baseUrl, adminKey } = instance
  const base = `${baseUrl.replace(/\/$/, "")}/v1`

  async function request<T>(path: string, init?: RequestInit): Promise<T> {
    let res: Response
    try {
      res = await fetch(`${base}${path}`, {
        ...init,
        headers: { "x-admin-key": adminKey, ...init?.headers },
      })
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      throw new Error(`Can't reach ${baseUrl}: ${msg}`)
    }
    if (res.status === 401) {
      throw new Error(`Admin key rejected for instance "${name}". Check your stored key.`)
    }
    if (res.status === 403) {
      throw new Error(`Forbidden (403) from instance "${name}".`)
    }
    if (!res.ok) {
      let detail = ""
      try {
        const body = (await res.json()) as { error?: string }
        detail = body.error ? `: ${body.error}` : ""
      } catch {
        // ignore parse error
      }
      throw new Error(`HTTP ${res.status} from ${baseUrl}${detail}`)
    }
    return res.json() as Promise<T>
  }

  function get<T>(path: string): Promise<T> {
    return request<T>(path)
  }

  function post<T>(path: string, body?: unknown): Promise<T> {
    return request<T>(path, {
      method: "POST",
      headers: body !== undefined ? { "Content-Type": "application/json" } : {},
      body: body !== undefined ? JSON.stringify(body) : undefined,
    })
  }

  return {
    health(): Promise<HealthResponse> {
      return get<HealthResponse>("/admin/health")
    },

    async recentLogs(q: LogQuery = {}): Promise<AdminLogRecord[]> {
      const params = new URLSearchParams()
      if (q.level) params.set("level", q.level)
      if (q.since) params.set("since", q.since)
      if (q.limit != null) params.set("limit", String(q.limit))
      const qs = params.toString()
      const data = await get<AdminLogsResponse>(`/admin/logs${qs ? `?${qs}` : ""}`)
      return data.records
    },

    async churchesList(q: ChurchesListQuery = {}): Promise<ChurchesListResponse> {
      const params = new URLSearchParams()
      if (q.slug_prefix) params.set("slug_prefix", q.slug_prefix)
      if (q.limit != null) params.set("limit", String(q.limit))
      if (q.offset != null) params.set("offset", String(q.offset))
      const qs = params.toString()
      return get<ChurchesListResponse>(`/admin/churches${qs ? `?${qs}` : ""}`)
    },

    churchGet(id: string): Promise<ChurchDetail> {
      return get<ChurchDetail>(`/admin/churches/${encodeURIComponent(id)}`)
    },

    async requestsList(q: RequestsListQuery = {}): Promise<RequestsListResponse> {
      const params = new URLSearchParams()
      if (q.status) params.set("status", q.status)
      if (q.user_id) params.set("user_id", q.user_id)
      if (q.limit != null) params.set("limit", String(q.limit))
      if (q.offset != null) params.set("offset", String(q.offset))
      const qs = params.toString()
      return get<RequestsListResponse>(`/admin/requests${qs ? `?${qs}` : ""}`)
    },

    requestGet(id: string): Promise<RequestDetail> {
      return get<RequestDetail>(`/admin/requests/${encodeURIComponent(id)}`)
    },

    channelAdd(body: ChannelAddBody): Promise<ChannelAddResponse> {
      return post<ChannelAddResponse>("/admin/channels", body)
    },

    async channelRefresh(q: ChannelRefreshQuery): Promise<ChannelRefreshResponse> {
      const params = new URLSearchParams({ churchSlug: q.churchSlug })
      if (q.force) params.set("force", "true")
      if (q.channel) params.set("channel", q.channel)
      return post<ChannelRefreshResponse>(`/admin/ingest/refresh?${params.toString()}`)
    },

    channelViewStats(churchSlug: string): Promise<ChannelViewStatsResponse> {
      return post<ChannelViewStatsResponse>("/admin/ingest/view-stats", { churchSlug })
    },

    async auditList(q: AuditListQuery = {}): Promise<AuditListResponse> {
      const params = new URLSearchParams()
      if (q.limit != null) params.set("limit", String(q.limit))
      if (q.offset != null) params.set("offset", String(q.offset))
      if (q.action) params.set("action", q.action)
      if (q.target_type) params.set("target_type", q.target_type)
      if (q.user_id) params.set("user_id", q.user_id)
      const qs = params.toString()
      return get<AuditListResponse>(`/admin/audit${qs ? `?${qs}` : ""}`)
    },
  }
}
