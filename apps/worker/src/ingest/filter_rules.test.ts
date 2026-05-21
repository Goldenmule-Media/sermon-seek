import { describe, expect, it } from "vitest"
import type { YoutubePlaylist } from "../youtube/types.js"
import { applyPlaylistFilterRules } from "./filter_rules.js"
import type { PlaylistFilterMode } from "./filter_rules.js"

function pl(id: string, title = id): YoutubePlaylist {
  return { id, snippet: { title } }
}

const PL_A = pl("PL_aaa", "Sermons")
const PL_B = pl("PL_bbb", "Announcements")
const PL_C = pl("PL_ccc", "Kids Ministry")
const ALL = [PL_A, PL_B, PL_C]

function ids(playlists: YoutubePlaylist[]): string[] {
  return playlists.map((p) => p.id)
}

describe("applyPlaylistFilterRules", () => {
  it("no rules → returns all playlists unchanged, mode none", () => {
    const { kept, mode, total, keptCount } = applyPlaylistFilterRules(ALL, [])
    expect(mode).toBe<PlaylistFilterMode>("none")
    expect(kept).toBe(ALL)
    expect(total).toBe(3)
    expect(keptCount).toBe(3)
  })

  it("single include rule → only that playlist kept, mode allowlist", () => {
    const { kept, mode, total, keptCount } = applyPlaylistFilterRules(ALL, [
      { rule_type: "include", target_kind: "playlist", target_id: "PL_aaa" },
    ])
    expect(mode).toBe<PlaylistFilterMode>("allowlist")
    expect(ids(kept)).toEqual(["PL_aaa"])
    expect(total).toBe(3)
    expect(keptCount).toBe(1)
  })

  it("single exclude rule → that playlist removed, others kept, mode denylist", () => {
    const { kept, mode, total, keptCount } = applyPlaylistFilterRules(ALL, [
      { rule_type: "exclude", target_kind: "playlist", target_id: "PL_bbb" },
    ])
    expect(mode).toBe<PlaylistFilterMode>("denylist")
    expect(ids(kept)).toEqual(["PL_aaa", "PL_ccc"])
    expect(total).toBe(3)
    expect(keptCount).toBe(2)
  })

  it("mixed include + exclude → allowlist wins, excludes are no-ops", () => {
    const { kept, mode, keptCount } = applyPlaylistFilterRules(ALL, [
      { rule_type: "include", target_kind: "playlist", target_id: "PL_aaa" },
      { rule_type: "exclude", target_kind: "playlist", target_id: "PL_aaa" },
      { rule_type: "exclude", target_kind: "playlist", target_id: "PL_ccc" },
    ])
    expect(mode).toBe<PlaylistFilterMode>("allowlist")
    expect(ids(kept)).toEqual(["PL_aaa"])
    expect(keptCount).toBe(1)
  })

  it("rules with non-playlist target_kind are ignored", () => {
    // Simulate a future enum value that this function should not treat as a playlist rule
    const futurKind = "video" as Parameters<
      typeof applyPlaylistFilterRules
    >[1][number]["target_kind"]
    const { kept, mode } = applyPlaylistFilterRules(ALL, [
      { rule_type: "include", target_kind: futurKind, target_id: "PL_aaa" },
    ])
    expect(mode).toBe<PlaylistFilterMode>("none")
    expect(ids(kept)).toEqual(ids(ALL))
  })
})
