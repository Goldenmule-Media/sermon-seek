import type { PlaylistFilterMode, PlaylistFilters } from "@sermon-search/types"

export function columnsToPlaylistFilters(
  include_playlist_ids: string[],
  exclude_playlist_ids: string[],
): PlaylistFilters {
  if (include_playlist_ids.length > 0) {
    return { mode: "include" as PlaylistFilterMode, playlist_ids: include_playlist_ids }
  }
  if (exclude_playlist_ids.length > 0) {
    return { mode: "exclude" as PlaylistFilterMode, playlist_ids: exclude_playlist_ids }
  }
  return { mode: "none" as PlaylistFilterMode, playlist_ids: [] }
}

export function playlistFiltersToColumns(pf: PlaylistFilters): {
  include_playlist_ids: string[]
  exclude_playlist_ids: string[]
} {
  if (pf.mode === "include") {
    return { include_playlist_ids: pf.playlist_ids, exclude_playlist_ids: [] }
  }
  if (pf.mode === "exclude") {
    return { include_playlist_ids: [], exclude_playlist_ids: pf.playlist_ids }
  }
  return { include_playlist_ids: [], exclude_playlist_ids: [] }
}
