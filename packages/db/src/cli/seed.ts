import { createDb, resolveDatabaseUrl } from "../index.js"

async function seed() {
  const db = createDb(resolveDatabaseUrl())
  try {
    const existing = await db
      .selectFrom("channels")
      .select("id")
      .where("youtube_channel_id", "=", "UC_seed")
      .executeTakeFirst()

    if (existing) {
      console.log("Seed data already exists, skipping.")
      return
    }

    console.log("Seeding database…")

    const channelRows = await db
      .insertInto("channels")
      .values({ youtube_channel_id: "UC_seed", title: "Seed Church" })
      .returning("id")
      .execute()

    const channel = channelRows[0]
    if (!channel) throw new Error("Failed to insert channel")

    const playlistRows = await db
      .insertInto("playlists")
      .values([
        {
          channel_id: channel.id,
          youtube_playlist_id: "PL_seed_1",
          slug: "grace-and-truth",
          title: "Grace & Truth",
          total_views: 120000,
          video_count: 5,
        },
        {
          channel_id: channel.id,
          youtube_playlist_id: "PL_seed_2",
          slug: "romans-8",
          title: "Romans 8 Deep Dive",
          total_views: 95000,
          video_count: 5,
        },
        {
          channel_id: channel.id,
          youtube_playlist_id: "PL_seed_3",
          slug: "forgiveness",
          title: "Forgiveness Journey",
          total_views: 67000,
          video_count: 3,
        },
        {
          channel_id: channel.id,
          youtube_playlist_id: "PL_seed_4",
          slug: "faith-foundations",
          title: "Faith Foundations",
          total_views: 42000,
          video_count: 2,
        },
        {
          channel_id: channel.id,
          youtube_playlist_id: "PL_seed_5",
          slug: "advent-2024",
          title: "Advent 2024",
          total_views: 18000,
          video_count: 3,
        },
      ])
      .returning(["id", "youtube_playlist_id"])
      .execute()

    const [p1, p2, p3, p4, p5] = playlistRows
    if (!p1 || !p2 || !p3 || !p4 || !p5) throw new Error("Failed to insert playlists")

    const videoSpec = [
      // Grace & Truth
      { id: "seed_v01", title: "What Is Grace?", date: "2024-11-10", dur: 2700, pl: p1.id },
      {
        id: "seed_v02",
        title: "Truth That Sets You Free",
        date: "2024-11-17",
        dur: 3120,
        pl: p1.id,
      },
      { id: "seed_v03", title: "Grace Under Pressure", date: "2024-11-24", dur: 2850, pl: p1.id },
      { id: "seed_v04", title: "Living in Grace", date: "2024-12-01", dur: 3300, pl: p1.id },
      { id: "seed_v05", title: "Grace and Works", date: "2024-12-08", dur: 2640, pl: p1.id },
      // Romans 8
      { id: "seed_v06", title: "No Condemnation", date: "2024-10-06", dur: 3600, pl: p2.id },
      { id: "seed_v07", title: "Walking by the Spirit", date: "2024-10-13", dur: 3480, pl: p2.id },
      { id: "seed_v08", title: "Children of God", date: "2024-10-20", dur: 2940, pl: p2.id },
      {
        id: "seed_v09",
        title: "All Things Work Together",
        date: "2024-10-27",
        dur: 3060,
        pl: p2.id,
      },
      { id: "seed_v10", title: "More Than Conquerors", date: "2024-11-03", dur: 3240, pl: p2.id },
      // Forgiveness Journey
      { id: "seed_v11", title: "Why Forgive?", date: "2024-09-01", dur: 2400, pl: p3.id },
      { id: "seed_v12", title: "Forgiving Others", date: "2024-09-08", dur: 2700, pl: p3.id },
      { id: "seed_v13", title: "Forgiving Yourself", date: "2024-09-15", dur: 2550, pl: p3.id },
      // Faith Foundations
      { id: "seed_v14", title: "Faith 101", date: "2025-01-05", dur: 2160, pl: p4.id },
      { id: "seed_v15", title: "Faith in Action", date: "2025-01-12", dur: 2400, pl: p4.id },
      // Advent 2024
      { id: "seed_v16", title: "Hope in Advent", date: "2025-02-01", dur: 1980, pl: p5.id },
      { id: "seed_v17", title: "Peace This Christmas", date: "2025-02-08", dur: 2100, pl: p5.id },
      { id: "seed_v18", title: "Joy to the World", date: "2025-02-15", dur: 2280, pl: p5.id },
    ]

    const videoRows = await db
      .insertInto("videos")
      .values(
        videoSpec.map((v) => ({
          channel_id: channel.id,
          youtube_video_id: v.id,
          title: v.title,
          published_at: new Date(v.date),
          duration_seconds: v.dur,
          thumbnail_url: "https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg",
        })),
      )
      .returning(["id", "youtube_video_id"])
      .execute()

    const videoMap = new Map(videoRows.map((v) => [v.youtube_video_id, v.id]))

    const playlistPositions = new Map<string, number>()
    const vpValues = videoSpec.map((v) => {
      const pos = (playlistPositions.get(v.pl) ?? 0) + 1
      playlistPositions.set(v.pl, pos)
      return {
        video_id: videoMap.get(v.id) ?? "",
        playlist_id: v.pl,
        position: pos,
      }
    })

    await db.insertInto("video_playlists").values(vpValues).execute()

    console.log(`Seeded: 1 channel, ${playlistRows.length} playlists, ${videoRows.length} videos.`)
  } finally {
    await db.destroy()
  }
}

seed().catch((err) => {
  console.error("Seed failed:", err)
  process.exit(1)
})
