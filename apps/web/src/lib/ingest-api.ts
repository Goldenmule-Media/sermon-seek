import type { PlaylistFilters } from "@sermon-search/types"
import { apiBase } from "./api"

export type { PlaylistFilters }

export interface PreflightAvailable {
  state: "available"
  youtube_channel_id: string
}

export interface PreflightAlreadyIngested {
  state: "already_ingested"
  existing_slug: string
  search_url: string
}

export interface PreflightRequestInFlight {
  state: "request_in_flight"
  existing_slug: string
  search_url: string
  is_yours: boolean
  request_id?: string
}

export interface PreflightChannelUnavailable {
  state: "channel_unavailable"
}

export interface PreflightUnknownHandle {
  state: "unknown_handle"
}

export type PreflightResponse =
  | PreflightAvailable
  | PreflightAlreadyIngested
  | PreflightRequestInFlight
  | PreflightChannelUnavailable
  | PreflightUnknownHandle

export interface PostIngestionBody {
  requested_slug: string
  requested_name: string
  youtube_handle_or_url: string
  playlist_filters: PlaylistFilters
  contact_email: string
}

export type PostIngestionResult =
  | { status: 201; request_id: string; status_url: string; search_url: string }
  | { status: 400; error: string; reason?: string }
  | { status: 401; error: string }
  | {
      status: 409
      error: string
      existing_slug?: string
      search_url?: string
      is_yours?: boolean
      request_id?: string
      note?: string
    }
  | { status: 422; error: "unknown_handle" }
  | { status: 422; error: "invalid_playlist_filters"; playlist_errors: Record<string, string> }
  | { status: 429; error: string; retry_after_seconds: number }
  | { status: "error"; error: string }

export type SlugAvailability = "available" | "invalid" | "taken" | "error"

export async function checkSlugAvailable(
  slug: string,
  signal?: AbortSignal,
): Promise<SlugAvailability> {
  try {
    const res = await fetch(`${apiBase()}/v1/requests/slug-available/${encodeURIComponent(slug)}`, {
      method: "HEAD",
      credentials: "include",
      signal,
    })
    if (res.status === 200) return "available"
    if (res.status === 409) return "taken"
    if (res.status === 400) return "invalid"
    return "error"
  } catch {
    return "error"
  }
}

export async function fetchChannelPreflight(
  handle: string,
  signal?: AbortSignal,
): Promise<PreflightResponse | null> {
  try {
    const url = new URL(`${apiBase()}/v1/requests/channel-preflight`)
    url.searchParams.set("handle", handle)
    const res = await fetch(url.toString(), { credentials: "include", signal })
    if (!res.ok) return null
    return res.json() as Promise<PreflightResponse>
  } catch {
    return null
  }
}

export async function postIngestionRequest(body: PostIngestionBody): Promise<PostIngestionResult> {
  try {
    const res = await fetch(`${apiBase()}/v1/requests`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    })
    const json = (await res.json()) as Record<string, unknown>
    if (res.status === 201) {
      return {
        status: 201,
        request_id: json.request_id as string,
        status_url: json.status_url as string,
        search_url: json.search_url as string,
      }
    }
    if (res.status === 400) {
      return { status: 400, error: json.error as string, reason: json.reason as string | undefined }
    }
    if (res.status === 401) {
      return { status: 401, error: json.error as string }
    }
    if (res.status === 409) {
      return {
        status: 409,
        error: json.error as string,
        existing_slug: json.existing_slug as string | undefined,
        search_url: json.search_url as string | undefined,
        is_yours: json.is_yours as boolean | undefined,
        request_id: json.request_id as string | undefined,
        note: json.note as string | undefined,
      }
    }
    if (res.status === 422) {
      if (json.error === "invalid_playlist_filters") {
        return {
          status: 422,
          error: "invalid_playlist_filters",
          playlist_errors: json.playlist_errors as Record<string, string>,
        }
      }
      return { status: 422, error: "unknown_handle" }
    }
    if (res.status === 429) {
      return {
        status: 429,
        error: json.error as string,
        retry_after_seconds: json.retry_after_seconds as number,
      }
    }
    return { status: "error", error: "Unexpected response from server." }
  } catch {
    return { status: "error", error: "Network error. Please try again." }
  }
}
