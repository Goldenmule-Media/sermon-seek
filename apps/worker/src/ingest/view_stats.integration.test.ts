import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createDb, migrateToLatest } from "@sermon-search/db"
import type { Database } from "@sermon-search/db"
import type { Kysely } from "kysely"
import { sql } from "kysely"
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"
import type { YoutubeClient } from "../youtube/client.js"
import type {
  ChannelsListResponse,
  PlaylistItemsListResponse,
  PlaylistsListResponse,
  VideosListResponse,
} from "../youtube/types.js"

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL
const describeIfDb = TEST_DATABASE_URL ? describe : describe.skip

const CHANNEL_ID = "UCintViewStats0000000001"

interface PlaylistSeed {
  youtubePlaylistId: string
  slug: string
  title: string
  videoIds: string[]
}

const PLAYLISTS: PlaylistSeed[] = [
  {
    youtubePlaylistId: "PLint_a",
    slug: "int-a",
    title: "Top Series",
    videoIds: ["int_v1", "int_v2", "int_v3"],
  },
  {
    youtubePlaylistId: "PLint_b",
    slug: "int-b",
    title: "Middle Series",
    videoIds: ["int_v4", "int_v5"],
  },
  {
    youtubePlaylistId: "PLint_c",
    slug: "int-c",
    title: "Lower Series",
    videoIds: ["int_v6"],
  },
  {
    youtubePlaylistId: "PLint_d",
    slug: "int-d",
    title: "Bottom Series",
    videoIds: ["int_v7"],
  },
]

function viewCountsRun1(): Map<string, string> {
  return new Map([
    ["int_v1", "1000"],
    ["int_v2", "2000"],
    ["int_v3", "3000"],
    ["int_v4", "500"],
    ["int_v5", "500"],
    ["int_v6", "200"],
    ["int_v7", "50"],
  ])
}

function viewCountsRun2(): Map<string, string> {
  return new Map([
    ["int_v1", "1500"],
    ["int_v2", "2500"],
    ["int_v3", "3500"],
    ["int_v4", "600"],
    ["int_v5", "600"],
    ["int_v6", "300"],
    ["int_v7", "75"],
  ])
}

function makeClient(counts: Map<string, string>): YoutubeClient {
  const partial: Partial<YoutubeClient> = {
    listChannelsById: vi.fn(
      async (id: string): Promise<ChannelsListResponse> => ({
        items: [{ id, snippet: { title: "Integration Channel" } }],
      }),
    ),
    listChannelsByHandle: vi.fn(async (): Promise<ChannelsListResponse> => ({ items: [] })),
    listChannelsByUsername: vi.fn(async (): Promise<ChannelsListResponse> => ({ items: [] })),
    listPlaylists: vi.fn(
      async (): Promise<PlaylistsListResponse> => ({
        items: PLAYLISTS.map((p) => ({
          id: p.youtubePlaylistId,
          snippet: { title: p.title, channelId: CHANNEL_ID },
          contentDetails: { itemCount: p.videoIds.length },
        })),
      }),
    ),
    listPlaylistItems: vi.fn(async (playlistId: string): Promise<PlaylistItemsListResponse> => {
      const pl = PLAYLISTS.find((p) => p.youtubePlaylistId === playlistId)
      if (!pl) return { items: [] }
      return {
        items: pl.videoIds.map((vid, i) => ({
          id: `${playlistId}-item-${i}`,
          contentDetails: { videoId: vid },
          snippet: { position: i, resourceId: { videoId: vid } },
        })),
      }
    }),
    listVideos: vi.fn(
      async (ids: readonly string[]): Promise<VideosListResponse> => ({
        items: ids.map((id) => {
          const viewCount = counts.get(id)
          return {
            id,
            snippet: { title: `Video ${id}` },
            statistics: viewCount === undefined ? {} : { viewCount },
          }
        }),
      }),
    ),
  }
  return partial as YoutubeClient
}

async function seedSchema(db: Kysely<Database>, churchId: string): Promise<void> {
  const channel = await db
    .insertInto("channels")
    .values({ church_id: churchId, youtube_channel_id: CHANNEL_ID, title: "Integration Channel" })
    .returning(["id"])
    .executeTakeFirstOrThrow()
  for (const pl of PLAYLISTS) {
    const playlistRow = await db
      .insertInto("playlists")
      .values({
        church_id: churchId,
        channel_id: channel.id,
        youtube_playlist_id: pl.youtubePlaylistId,
        slug: pl.slug,
        title: pl.title,
        position: 0,
      })
      .returning(["id"])
      .executeTakeFirstOrThrow()
    for (let i = 0; i < pl.videoIds.length; i++) {
      const youtubeVideoId = pl.videoIds[i]
      if (!youtubeVideoId) continue
      const existing = await db
        .selectFrom("videos")
        .select(["id"])
        .where("youtube_video_id", "=", youtubeVideoId)
        .executeTakeFirst()
      const videoId =
        existing?.id ??
        (
          await db
            .insertInto("videos")
            .values({
              church_id: churchId,
              channel_id: channel.id,
              youtube_video_id: youtubeVideoId,
              title: `Video ${youtubeVideoId}`,
            })
            .returning(["id"])
            .executeTakeFirstOrThrow()
        ).id
      await db
        .insertInto("video_playlists")
        .values({ video_id: videoId, playlist_id: playlistRow.id, position: i })
        .onConflict((oc) => oc.columns(["video_id", "playlist_id"]).doNothing())
        .execute()
    }
  }
}

describeIfDb("runViewStats (integration)", () => {
  let tmpRoot: string
  let db: Kysely<Database>
  let churchId: string
  // biome-ignore lint/suspicious/noExplicitAny: dynamic ESM import for test environment.
  let runViewStats: any

  beforeAll(async () => {
    if (TEST_DATABASE_URL === process.env.DATABASE_URL) {
      throw new Error(
        "TEST_DATABASE_URL must not equal DATABASE_URL — point it at a throwaway database (e.g. sermon_search_test)",
      )
    }
    await migrateToLatest(TEST_DATABASE_URL)
    tmpRoot = await mkdtemp(join(tmpdir(), "sermon-view-stats-int-"))
    process.env.CACHE_DIR = tmpRoot
    vi.resetModules()
    const mod = await import("./view_stats.js")
    runViewStats = mod.runViewStats
    db = createDb(TEST_DATABASE_URL)
    const churchRow = await db
      .insertInto("churches")
      .values({ slug: "test-church-int", name: "Test Church Int" })
      .onConflict((oc) => oc.column("slug").doUpdateSet({ name: "Test Church Int" }))
      .returning(["id"])
      .executeTakeFirstOrThrow()
    churchId = churchRow.id
  })

  afterAll(async () => {
    await db.destroy()
    await rm(tmpRoot, { recursive: true, force: true })
  })

  beforeEach(async () => {
    await sql`TRUNCATE channels RESTART IDENTITY CASCADE`.execute(db)
  })

  it("populates view_count and per-playlist aggregates; top-3 ORDER BY works", async () => {
    await seedSchema(db, churchId)

    const client = makeClient(viewCountsRun1())
    const summary = await runViewStats({ db, client, churchId })
    expect(summary.channelCount).toBe(1)
    expect(summary.playlistCount).toBe(PLAYLISTS.length)

    const videoRows = await db
      .selectFrom("videos")
      .select(["youtube_video_id", "view_count", "view_count_updated_at"])
      .execute()
    expect(videoRows.length).toBe(7)
    for (const row of videoRows) {
      expect(row.view_count_updated_at).not.toBeNull()
      expect(row.view_count).not.toBeNull()
    }

    const playlistRows = await db
      .selectFrom("playlists")
      .select(["slug", "total_views", "video_count", "stats_updated_at"])
      .orderBy("total_views", "desc")
      .execute()
    for (const row of playlistRows) {
      expect(row.stats_updated_at).not.toBeNull()
      expect(row.total_views).not.toBeNull()
    }

    const top3 = await db
      .selectFrom("playlists")
      .select(["slug", "total_views"])
      .orderBy("total_views", "desc")
      .limit(3)
      .execute()
    expect(top3.map((r) => r.slug)).toEqual(["int-a", "int-b", "int-c"])
    expect(top3[0]?.total_views).toBe("6000")
    expect(top3[1]?.total_views).toBe("1000")
    expect(top3[2]?.total_views).toBe("200")
  })

  it("second run refreshes counts; row counts unchanged", async () => {
    await seedSchema(db, churchId)

    await runViewStats({ db, client: makeClient(viewCountsRun1()), churchId })
    const channelsAfter1 = await db.selectFrom("channels").select(["id"]).execute()
    const playlistsAfter1 = await db.selectFrom("playlists").select(["id"]).execute()
    const videosAfter1 = await db.selectFrom("videos").select(["id"]).execute()
    const joinAfter1 = await db.selectFrom("video_playlists").select(["video_id"]).execute()
    const playlistAStatsBefore = await db
      .selectFrom("playlists")
      .select(["stats_updated_at"])
      .where("youtube_playlist_id", "=", "PLint_a")
      .executeTakeFirstOrThrow()
    const v1Before = await db
      .selectFrom("videos")
      .select(["view_count_updated_at"])
      .where("youtube_video_id", "=", "int_v1")
      .executeTakeFirstOrThrow()

    await new Promise((resolve) => setTimeout(resolve, 10))

    await runViewStats({ db, client: makeClient(viewCountsRun2()), churchId })

    expect((await db.selectFrom("channels").select(["id"]).execute()).length).toBe(
      channelsAfter1.length,
    )
    expect((await db.selectFrom("playlists").select(["id"]).execute()).length).toBe(
      playlistsAfter1.length,
    )
    expect((await db.selectFrom("videos").select(["id"]).execute()).length).toBe(
      videosAfter1.length,
    )
    expect((await db.selectFrom("video_playlists").select(["video_id"]).execute()).length).toBe(
      joinAfter1.length,
    )

    const playlistAStatsAfter = await db
      .selectFrom("playlists")
      .select(["total_views", "stats_updated_at"])
      .where("youtube_playlist_id", "=", "PLint_a")
      .executeTakeFirstOrThrow()
    expect(playlistAStatsAfter.total_views).toBe("7500")
    expect(playlistAStatsAfter.stats_updated_at).not.toBeNull()
    expect(playlistAStatsAfter.stats_updated_at?.getTime()).toBeGreaterThan(
      playlistAStatsBefore.stats_updated_at?.getTime() ?? 0,
    )

    const v1After = await db
      .selectFrom("videos")
      .select(["view_count", "view_count_updated_at"])
      .where("youtube_video_id", "=", "int_v1")
      .executeTakeFirstOrThrow()
    expect(v1After.view_count).toBe("1500")
    expect(v1After.view_count_updated_at?.getTime()).toBeGreaterThan(
      v1Before.view_count_updated_at?.getTime() ?? 0,
    )
  })
})
