import type { Database } from "@sermon-search/db"
import type { Kysely } from "kysely"

const A_CHURCH_ID = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"
const B_CHURCH_ID = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb"
const A_CHANNEL_ID = "aaaaaaaa-aaaa-aaaa-aaaa-000000000001"
const B_CHANNEL_ID = "bbbbbbbb-bbbb-bbbb-bbbb-000000000001"
const A_PLAYLIST_ID = "aaaaaaaa-aaaa-aaaa-aaaa-000000000002"
const B_PLAYLIST_ID = "bbbbbbbb-bbbb-bbbb-bbbb-000000000002"
const A_VIDEO_1_ID = "aaaaaaaa-aaaa-aaaa-aaaa-000000000003"
const A_VIDEO_2_ID = "aaaaaaaa-aaaa-aaaa-aaaa-000000000004"
const B_VIDEO_1_ID = "bbbbbbbb-bbbb-bbbb-bbbb-000000000003"
const B_VIDEO_2_ID = "bbbbbbbb-bbbb-bbbb-bbbb-000000000004"
const A_TRANSCRIPT_1_ID = "aaaaaaaa-aaaa-aaaa-aaaa-000000000005"
const A_TRANSCRIPT_2_ID = "aaaaaaaa-aaaa-aaaa-aaaa-000000000006"
const B_TRANSCRIPT_1_ID = "bbbbbbbb-bbbb-bbbb-bbbb-000000000005"
const B_TRANSCRIPT_2_ID = "bbbbbbbb-bbbb-bbbb-bbbb-000000000006"
const A_TOPIC_ID = "aaaaaaaa-aaaa-aaaa-aaaa-000000000007"
const B_TOPIC_ID = "bbbbbbbb-bbbb-bbbb-bbbb-000000000007"

export interface SeedResult {
  aSlug: string
  bSlug: string
  aId: string
  bId: string
  ytA1: string
  ytA2: string
  ytB1: string
  ytB2: string
  playlistSlug: string
  topicSlug: string
}

export async function seedChurches(db: Kysely<Database>): Promise<SeedResult> {
  await db
    .insertInto("churches")
    .values([
      { id: A_CHURCH_ID, slug: "alpha", name: "Alpha Church" },
      { id: B_CHURCH_ID, slug: "bravo", name: "Bravo Church" },
    ])
    .execute()

  await db
    .insertInto("channels")
    .values([
      {
        id: A_CHANNEL_ID,
        church_id: A_CHURCH_ID,
        youtube_channel_id: "UCalphatest001",
        title: "Alpha Channel",
      },
      {
        id: B_CHANNEL_ID,
        church_id: B_CHURCH_ID,
        youtube_channel_id: "UCbravotest001",
        title: "Bravo Channel",
      },
    ])
    .execute()

  await db
    .insertInto("playlists")
    .values([
      {
        id: A_PLAYLIST_ID,
        channel_id: A_CHANNEL_ID,
        church_id: A_CHURCH_ID,
        youtube_playlist_id: "PLalphatest001",
        slug: "sermons",
        title: "Alpha Sermons",
        position: 1,
      },
      {
        id: B_PLAYLIST_ID,
        channel_id: B_CHANNEL_ID,
        church_id: B_CHURCH_ID,
        youtube_playlist_id: "PLbravotest001",
        slug: "sermons",
        title: "Bravo Sermons",
        position: 1,
      },
    ])
    .execute()

  await db
    .insertInto("videos")
    .values([
      {
        id: A_VIDEO_1_ID,
        channel_id: A_CHANNEL_ID,
        church_id: A_CHURCH_ID,
        youtube_video_id: "ytALPHA0001",
        title: "Alpha Sermon One",
        published_at: new Date("2024-01-01"),
      },
      {
        id: A_VIDEO_2_ID,
        channel_id: A_CHANNEL_ID,
        church_id: A_CHURCH_ID,
        youtube_video_id: "ytALPHA0002",
        title: "Alpha Sermon Two",
        published_at: new Date("2024-01-02"),
      },
      {
        id: B_VIDEO_1_ID,
        channel_id: B_CHANNEL_ID,
        church_id: B_CHURCH_ID,
        youtube_video_id: "ytBRAVO0001",
        title: "Bravo Sermon One",
        published_at: new Date("2024-01-01"),
      },
      {
        id: B_VIDEO_2_ID,
        channel_id: B_CHANNEL_ID,
        church_id: B_CHURCH_ID,
        youtube_video_id: "ytBRAVO0002",
        title: "Bravo Sermon Two",
        published_at: new Date("2024-01-02"),
      },
    ])
    .execute()

  await db
    .insertInto("video_playlists")
    .values([
      { video_id: A_VIDEO_1_ID, playlist_id: A_PLAYLIST_ID, position: 1 },
      { video_id: A_VIDEO_2_ID, playlist_id: A_PLAYLIST_ID, position: 2 },
      { video_id: B_VIDEO_1_ID, playlist_id: B_PLAYLIST_ID, position: 1 },
      { video_id: B_VIDEO_2_ID, playlist_id: B_PLAYLIST_ID, position: 2 },
    ])
    .execute()

  // Transcripts make all four videos visible via videos_with_transcripts view.
  await db
    .insertInto("transcripts")
    .values([
      {
        id: A_TRANSCRIPT_1_ID,
        video_id: A_VIDEO_1_ID,
        source: "whisper",
        language: "en",
        full_text: "Alpha church sermon about grace and salvation",
      },
      {
        id: A_TRANSCRIPT_2_ID,
        video_id: A_VIDEO_2_ID,
        source: "whisper",
        language: "en",
        full_text: "Alpha church second sermon about grace and faith",
      },
      {
        id: B_TRANSCRIPT_1_ID,
        video_id: B_VIDEO_1_ID,
        source: "whisper",
        language: "en",
        full_text: "Bravo church sermon about grace and salvation",
      },
      {
        id: B_TRANSCRIPT_2_ID,
        video_id: B_VIDEO_2_ID,
        source: "whisper",
        language: "en",
        full_text: "Bravo church second sermon about grace and faith",
      },
    ])
    .execute()

  // Segments are needed by the transcript route and segment-start refinement.
  // text_tsv is GENERATED ALWAYS AS — omit from insert.
  await db
    .insertInto("transcript_segments")
    .values([
      {
        transcript_id: A_TRANSCRIPT_1_ID,
        video_id: A_VIDEO_1_ID,
        start_ms: 0,
        end_ms: 30000,
        text: "Alpha church sermon about grace and salvation",
      },
      {
        transcript_id: A_TRANSCRIPT_2_ID,
        video_id: A_VIDEO_2_ID,
        start_ms: 0,
        end_ms: 30000,
        text: "Alpha church second sermon about grace and faith",
      },
      {
        transcript_id: B_TRANSCRIPT_1_ID,
        video_id: B_VIDEO_1_ID,
        start_ms: 0,
        end_ms: 30000,
        text: "Bravo church sermon about grace and salvation",
      },
      {
        transcript_id: B_TRANSCRIPT_2_ID,
        video_id: B_VIDEO_2_ID,
        start_ms: 0,
        end_ms: 30000,
        text: "Bravo church second sermon about grace and faith",
      },
    ])
    .execute()

  // Chunks are the FTS target for /search and /videos/:id/search.
  // text_tsv is GENERATED ALWAYS AS — omit from insert.
  await db
    .insertInto("transcript_chunks")
    .values([
      {
        video_id: A_VIDEO_1_ID,
        transcript_id: A_TRANSCRIPT_1_ID,
        church_id: A_CHURCH_ID,
        start_ms: 0,
        end_ms: 30000,
        text: "Alpha church sermon about grace and salvation",
        position: 1,
      },
      {
        video_id: A_VIDEO_2_ID,
        transcript_id: A_TRANSCRIPT_2_ID,
        church_id: A_CHURCH_ID,
        start_ms: 0,
        end_ms: 30000,
        text: "Alpha church second sermon about grace and faith",
        position: 1,
      },
      {
        video_id: B_VIDEO_1_ID,
        transcript_id: B_TRANSCRIPT_1_ID,
        church_id: B_CHURCH_ID,
        start_ms: 0,
        end_ms: 30000,
        text: "Bravo church sermon about grace and salvation",
        position: 1,
      },
      {
        video_id: B_VIDEO_2_ID,
        transcript_id: B_TRANSCRIPT_2_ID,
        church_id: B_CHURCH_ID,
        start_ms: 0,
        end_ms: 30000,
        text: "Bravo church second sermon about grace and faith",
        position: 1,
      },
    ])
    .execute()

  // Topics use the church-scoped unique index — same slug in different churches is valid.
  await db
    .insertInto("topics")
    .values([
      { id: A_TOPIC_ID, church_id: A_CHURCH_ID, slug: "grace", label: "Grace" },
      { id: B_TOPIC_ID, church_id: B_CHURCH_ID, slug: "grace", label: "Grace" },
    ])
    .execute()

  await db
    .insertInto("video_topics")
    .values([
      { video_id: A_VIDEO_1_ID, topic_id: A_TOPIC_ID, position: 1 },
      { video_id: A_VIDEO_2_ID, topic_id: A_TOPIC_ID, position: 1 },
      { video_id: B_VIDEO_1_ID, topic_id: B_TOPIC_ID, position: 1 },
      { video_id: B_VIDEO_2_ID, topic_id: B_TOPIC_ID, position: 1 },
    ])
    .execute()

  // Related videos: A1→A2 and B1→B2. Isolation is enforced in the query by
  // joining to videos_with_transcripts filtered by church_id.
  await db
    .insertInto("related_videos")
    .values([
      {
        video_id: A_VIDEO_1_ID,
        related_video_id: A_VIDEO_2_ID,
        signal: "topic_overlap",
        score: 0.8,
        payload: JSON.stringify({ topics: ["grace"] }),
      },
      {
        video_id: B_VIDEO_1_ID,
        related_video_id: B_VIDEO_2_ID,
        signal: "topic_overlap",
        score: 0.8,
        payload: JSON.stringify({ topics: ["grace"] }),
      },
    ])
    .execute()

  return {
    aSlug: "alpha",
    bSlug: "bravo",
    aId: A_CHURCH_ID,
    bId: B_CHURCH_ID,
    ytA1: "ytALPHA0001",
    ytA2: "ytALPHA0002",
    ytB1: "ytBRAVO0001",
    ytB2: "ytBRAVO0002",
    playlistSlug: "sermons",
    topicSlug: "grace",
  }
}
