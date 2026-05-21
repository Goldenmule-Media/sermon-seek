import type { IngestionFilterRuleType, IngestionFilterTargetKind } from "@sermon-search/db"
import type { YoutubePlaylist } from "../youtube/types.js"

export type PlaylistFilterMode = "none" | "allowlist" | "denylist"

interface RuleRow {
  rule_type: IngestionFilterRuleType
  target_kind: IngestionFilterTargetKind
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
