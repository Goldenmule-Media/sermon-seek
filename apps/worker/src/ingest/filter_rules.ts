import type { IngestionFilterRuleType } from "@sermon-search/db"
import { YoutubeApiError, type YoutubeClient } from "../youtube/client.js"
import type { YoutubePlaylist } from "../youtube/types.js"

export type PlaylistFilterMode = "none" | "allowlist" | "denylist"

interface RuleRow {
  rule_type: IngestionFilterRuleType
  target_kind: string
  target_id: string
}

export interface PlaylistFilterResult {
  kept: YoutubePlaylist[]
  mode: PlaylistFilterMode
  total: number
  keptCount: number
}

export function applyPlaylistFilterRules(
  playlists: YoutubePlaylist[],
  rules: RuleRow[],
): PlaylistFilterResult {
  const playlistRules = rules.filter((r) => r.target_kind === "playlist")

  const includeIds = new Set(
    playlistRules.filter((r) => r.rule_type === "include").map((r) => r.target_id),
  )
  const excludeIds = new Set(
    playlistRules.filter((r) => r.rule_type === "exclude").map((r) => r.target_id),
  )

  let kept: YoutubePlaylist[]
  let mode: PlaylistFilterMode

  if (includeIds.size > 0) {
    mode = "allowlist"
    kept = playlists.filter((pl) => includeIds.has(pl.id))
  } else if (excludeIds.size > 0) {
    mode = "denylist"
    kept = playlists.filter((pl) => !excludeIds.has(pl.id))
  } else {
    mode = "none"
    kept = playlists
  }

  return { kept, mode, total: playlists.length, keptCount: kept.length }
}

export type ValidatePlaylistResult =
  | { ok: true }
  | { ok: false; reason: "not_found" | "wrong_channel" | "youtube_error"; message: string }

export async function validatePlaylistTarget({
  youtube,
  youtubeChannelId,
  targetId,
}: {
  youtube: YoutubeClient
  youtubeChannelId: string
  targetId: string
}): Promise<ValidatePlaylistResult> {
  try {
    const plResponse = await youtube.listPlaylistsById(targetId)
    const playlist = plResponse.items?.[0]
    if (!playlist) {
      return {
        ok: false,
        reason: "not_found",
        message: `Playlist not found on YouTube: ${targetId}`,
      }
    }
    if (playlist.snippet?.channelId !== youtubeChannelId) {
      return {
        ok: false,
        reason: "wrong_channel",
        message: `Playlist ${targetId} does not belong to this channel`,
      }
    }
    return { ok: true }
  } catch (err) {
    if (err instanceof YoutubeApiError) {
      return { ok: false, reason: "youtube_error", message: `YouTube API error: ${err.message}` }
    }
    throw err
  }
}
