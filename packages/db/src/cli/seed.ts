import { extract } from "@sermon-search/scripture"
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

    const [churchRow] = await db
      .insertInto("churches")
      .values({ slug: "jubileestl", name: "Jubilee Church STL" })
      .onConflict((oc) => oc.column("slug").doUpdateSet((eb) => ({ name: eb.ref("excluded.name") })))
      .returning("id")
      .execute()
    if (!churchRow) throw new Error("Failed to insert church")
    const churchId = churchRow.id

    const channelRows = await db
      .insertInto("channels")
      .values({ church_id: churchId, youtube_channel_id: "UC_seed", title: "Seed Church" })
      .returning("id")
      .execute()

    const channel = channelRows[0]
    if (!channel) throw new Error("Failed to insert channel")

    const playlistRows = await db
      .insertInto("playlists")
      .values([
        {
          church_id: churchId,
          channel_id: channel.id,
          youtube_playlist_id: "PL_seed_1",
          slug: "grace-and-truth",
          title: "Grace & Truth",
          total_views: 120000,
          video_count: 5,
        },
        {
          church_id: churchId,
          channel_id: channel.id,
          youtube_playlist_id: "PL_seed_2",
          slug: "romans-8",
          title: "Romans 8 Deep Dive",
          total_views: 95000,
          video_count: 5,
        },
        {
          church_id: churchId,
          channel_id: channel.id,
          youtube_playlist_id: "PL_seed_3",
          slug: "forgiveness",
          title: "Forgiveness Journey",
          total_views: 67000,
          video_count: 3,
        },
        {
          church_id: churchId,
          channel_id: channel.id,
          youtube_playlist_id: "PL_seed_4",
          slug: "faith-foundations",
          title: "Faith Foundations",
          total_views: 42000,
          video_count: 2,
        },
        {
          church_id: churchId,
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
          church_id: churchId,
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

    // Seed topics
    const topicDefs = [
      { church_id: churchId, slug: "grace", label: "grace" },
      { church_id: churchId, slug: "forgiveness", label: "forgiveness" },
      { church_id: churchId, slug: "faith", label: "faith" },
      { church_id: churchId, slug: "romans-8", label: "romans 8" },
      { church_id: churchId, slug: "holy-spirit", label: "holy spirit" },
      { church_id: churchId, slug: "hope", label: "hope" },
    ]
    const insertedTopics = await db
      .insertInto("topics")
      .values(topicDefs)
      .onConflict((oc) => oc.columns(["church_id", "slug"]).doNothing())
      .returning(["id", "slug"])
      .execute()

    const topicMap = new Map(insertedTopics.map((t) => [t.slug, t.id]))

    // Per-video enrichment: summary + topics + scripture refs
    const enrichmentSpec: Array<{
      ytId: string
      summary: string
      topics: string[]
      refs: string[]
    }> = [
      {
        ytId: "seed_v01",
        summary:
          "This sermon explores the nature of grace as an unmerited gift from God. The pastor unpacks Romans 3:24 and illustrates how grace transforms our relationship with the divine. Practical examples show grace operating in everyday life and community.",
        topics: ["grace", "faith", "forgiveness"],
        refs: ["Romans 3:24", "Ephesians 2:8"],
      },
      {
        ytId: "seed_v02",
        summary:
          "Examining John 8:32, this message shows how embracing truth leads to spiritual freedom. The sermon challenges listeners to confront comfortable lies and walk in the liberating truth of the Gospel.",
        topics: ["faith", "hope", "grace"],
        refs: ["John 8:32"],
      },
      {
        ytId: "seed_v03",
        summary:
          "A deep look at how grace sustains believers through hardship. Drawing on Paul's thorn in the flesh, the pastor demonstrates that God's grace is sufficient even in our weakest moments.",
        topics: ["grace", "faith", "holy-spirit"],
        refs: ["2 Cor 12:9"],
      },
      {
        ytId: "seed_v04",
        summary:
          "This message teaches practical ways to walk daily in the grace of God. Through narrative and scripture the sermon shows that grace is not just a theological concept but a lived reality.",
        topics: ["grace", "faith"],
        refs: ["Romans 5:2"],
      },
      {
        ytId: "seed_v05",
        summary:
          "Addressing the tension between grace and works, the pastor carefully exegetes Ephesians 2:8–10. Listeners learn that good works flow from grace rather than earning it.",
        topics: ["grace", "faith", "forgiveness"],
        refs: ["Ephesians 2:8"],
      },
      {
        ytId: "seed_v06",
        summary:
          "Romans 8:1 anchors this powerful message on freedom from condemnation. The sermon traces the believer's journey from guilt to total acceptance in Christ.",
        topics: ["romans-8", "forgiveness", "grace"],
        refs: ["Romans 8:1"],
      },
      {
        ytId: "seed_v07",
        summary:
          "An exposition of Romans 8:4–11 on Spirit-led living. The pastor contrasts life in the flesh with life in the Spirit and gives practical guidance for walking by the Spirit daily.",
        topics: ["holy-spirit", "romans-8", "faith"],
        refs: ["Romans 8:4"],
      },
      {
        ytId: "seed_v08",
        summary:
          "Exploring what it means to be adopted as children of God per Romans 8:15–17. This sermon unpacks our spiritual inheritance and the confidence it brings.",
        topics: ["romans-8", "faith", "hope"],
        refs: ["Romans 8:15"],
      },
      {
        ytId: "seed_v09",
        summary:
          "Romans 8:28 is the lens for this encouraging message. The pastor shows from scripture and personal testimony that God weaves all circumstances—good and difficult—into his redemptive purposes.",
        topics: ["romans-8", "hope", "faith"],
        refs: ["Romans 8:28"],
      },
      {
        ytId: "seed_v10",
        summary:
          "The climax of Romans 8 forms the basis of this declaration that nothing can separate us from God's love. Listeners are called to live as more than conquerors through Christ.",
        topics: ["romans-8", "hope", "faith"],
        refs: ["Romans 8:37"],
      },
      {
        ytId: "seed_v11",
        summary:
          "Why is forgiveness so central to the Christian life? This sermon answers that question through the parable of the unforgiving servant and shows how receiving forgiveness empowers us to offer it.",
        topics: ["forgiveness", "grace", "faith"],
        refs: ["Matthew 18:21"],
      },
      {
        ytId: "seed_v12",
        summary:
          "A practical guide to forgiving others drawn from Ephesians 4:32. The pastor dispels myths about forgiveness and outlines steps toward releasing bitterness and choosing freedom.",
        topics: ["forgiveness", "grace", "holy-spirit"],
        refs: ["Ephesians 4:32"],
      },
      {
        ytId: "seed_v13",
        summary:
          "Many believers struggle to forgive themselves even after experiencing God's forgiveness. This sermon applies 1 John 1:9 to the inner voice of shame and guilt.",
        topics: ["forgiveness", "grace", "hope"],
        refs: ["1 John 1:9"],
      },
      {
        ytId: "seed_v14",
        summary:
          "An introductory survey of biblical faith using Hebrews 11:1 as the foundation. The pastor explains what faith is, what it is not, and how it grows.",
        topics: ["faith", "hope", "grace"],
        refs: ["Hebrews 11:1"],
      },
      {
        ytId: "seed_v15",
        summary:
          "James 2:17 drives this message that genuine faith produces action. Through case studies from Scripture the pastor challenges listeners to let their faith be made visible.",
        topics: ["faith", "holy-spirit"],
        refs: ["James 2:17"],
      },
      {
        ytId: "seed_v16",
        summary:
          "The first Advent message focuses on hope, anchored in Romans 15:13. The sermon reclaims Advent as a season of expectant waiting rather than mere holiday tradition.",
        topics: ["hope", "faith", "grace"],
        refs: ["Romans 15:13"],
      },
      {
        ytId: "seed_v17",
        summary:
          "Philippians 4:7 grounds this Christmas message on the peace that transcends understanding. The pastor shows how the Prince of Peace brings stillness to anxious hearts.",
        topics: ["hope", "faith", "holy-spirit"],
        refs: ["Philippians 4:7"],
      },
      {
        ytId: "seed_v18",
        summary:
          "Closing the Advent series with Luke 2:10 as the anchor, this sermon unpacks the joy that the birth of Christ brings to the world and to individual hearts.",
        topics: ["hope", "grace", "faith"],
        refs: ["Luke 2:10"],
      },
    ]

    for (const spec of enrichmentSpec) {
      const videoId = videoMap.get(spec.ytId)
      if (!videoId) continue

      await db
        .insertInto("video_enrichments")
        .values({
          video_id: videoId,
          summary: spec.summary,
          model: "seed",
          model_version: "seed",
        })
        .onConflict((oc) => oc.column("video_id").doNothing())
        .execute()

      const topicIds = spec.topics
        .map((slug) => topicMap.get(slug))
        .filter((id): id is string => id !== undefined)

      if (topicIds.length > 0) {
        await db
          .insertInto("video_topics")
          .values(topicIds.map((topic_id, position) => ({ video_id: videoId, topic_id, position })))
          .onConflict((oc) => oc.columns(["video_id", "topic_id"]).doNothing())
          .execute()
      }

      for (const refStr of spec.refs) {
        const extracted = extract(refStr)
        if (extracted.length === 0) continue
        const ref = extracted[0]!
        await db
          .insertInto("video_scripture_refs")
          .values({
            video_id: videoId,
            book_id: ref.book_id,
            chapter_start: ref.chapter_start,
            verse_start: ref.verse_start,
            chapter_end: ref.chapter_end,
            verse_end: ref.verse_end,
            start_coord: ref.start_coord,
            end_coord: ref.end_coord,
            occurrences: ref.occurrences,
            positions: ref.positions,
            first_position: ref.first_position,
            raw_first: ref.raw_first,
          })
          .onConflict((oc) => oc.columns(["video_id", "start_coord", "end_coord"]).doNothing())
          .execute()
      }
    }

    console.log(
      `Seeded: 1 channel, ${playlistRows.length} playlists, ${videoRows.length} videos, ${enrichmentSpec.length} enrichments.`,
    )
  } finally {
    await db.destroy()
  }
}

seed().catch((err) => {
  console.error("Seed failed:", err)
  process.exit(1)
})
