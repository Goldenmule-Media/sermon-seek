import type { Database } from "@sermon-search/db"
import type { Embedder } from "@sermon-search/embeddings"
import type { Kysely, SqlBool } from "kysely"
import { sql } from "kysely"
import type { FtsResponse, FtsResult } from "./fts.js"

export interface SemanticOptions {
  q: string
  videoId?: string
  limit: number
  offset: number
  topicSlug?: string
  playlistSlug?: string
  publishedAfter?: Date
}

const STOPWORDS = new Set([
  "the", "and", "for", "with", "that", "this", "from", "you", "your", "are", "but",
  "not", "what", "when", "where", "how", "why", "who", "which", "about", "have", "has",
  "was", "were", "will", "would", "could", "should", "into", "than", "then", "them",
])

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => {
    switch (c) {
      case "&": return "&amp;"
      case "<": return "&lt;"
      case ">": return "&gt;"
      case '"': return "&quot;"
      default: return "&#39;"
    }
  })
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

// Build an FTS-style snippet: window of ~20 words centered on the first query-token hit
// (or the start of the chunk if no token appears), with matched tokens wrapped in <mark>.
// Matches `ts_headline` visual treatment so semantic-only hits don't read as "the
// search ignored my words" next to keyword hits.
function buildSnippet(text: string, q: string, words = 22): string {
  const tokens = q
    .toLowerCase()
    .split(/[^a-z0-9']+/)
    .filter((t) => t.length >= 3 && !STOPWORDS.has(t))
  const allWords = text.split(/\s+/).filter(Boolean)

  let start = 0
  if (tokens.length > 0) {
    const idx = allWords.findIndex((w) => {
      const lw = w.toLowerCase()
      return tokens.some((t) => lw.includes(t))
    })
    if (idx >= 0) start = Math.max(0, idx - 4)
  }

  const window = allWords.slice(start, start + words).join(" ")
  if (tokens.length === 0) return escapeHtml(window)

  // Wrap matches with sentinels (impossible in real text), escape HTML, then swap
  // sentinels for <mark> — avoids escaping our own tags or injecting raw user text.
  const pattern = new RegExp(`(${tokens.map(escapeRegex).join("|")})`, "gi")
  const OPEN = "\x00MK\x00"
  const CLOSE = "\x00/MK\x00"
  const marked = window.replace(pattern, `${OPEN}$1${CLOSE}`)
  return escapeHtml(marked).replaceAll(OPEN, "<mark>").replaceAll(CLOSE, "</mark>")
}

export async function searchSemantic(
  db: Kysely<Database>,
  embedder: Embedder,
  opts: SemanticOptions,
): Promise<FtsResponse> {
  const { q, videoId, limit, offset, topicSlug, playlistSlug, publishedAfter } = opts

  const [queryVec] = await embedder.embed([q])
  const vecStr = `[${(queryVec as number[]).join(",")}]`

  type Row = {
    youtube_video_id: string
    title: string
    thumbnail_url: string | null
    start_ms: number
    score: number
    text: string
  }

  let query = db
    .selectFrom("embeddings as e")
    .innerJoin("transcript_chunks as c", "c.id", "e.chunk_id")
    .innerJoin("videos as v", "v.id", "c.video_id")
    .select([
      "v.youtube_video_id",
      "v.title",
      "v.thumbnail_url",
      "c.start_ms",
      "c.text",
      sql<number>`1 - (e.vector <=> ${vecStr}::vector)`.as("score"),
    ])
    .where("e.model", "=", embedder.model)
    .orderBy(sql`e.vector <=> ${vecStr}::vector`, "asc")
    .limit(limit)
    .offset(offset)

  let countQuery = db
    .selectFrom("embeddings as e")
    .innerJoin("transcript_chunks as c", "c.id", "e.chunk_id")
    .innerJoin("videos as v", "v.id", "c.video_id")
    .select(sql<string>`count(*)`.as("count"))
    .where("e.model", "=", embedder.model)

  if (videoId !== undefined) {
    query = query.where("v.youtube_video_id", "=", videoId)
    countQuery = countQuery.where("v.youtube_video_id", "=", videoId)
  }
  if (topicSlug !== undefined) {
    const pred = sql<SqlBool>`v.id IN (SELECT vt.video_id FROM video_topics vt INNER JOIN topics t ON t.id = vt.topic_id WHERE t.slug = ${topicSlug})`
    query = query.where(pred)
    countQuery = countQuery.where(pred)
  }
  if (playlistSlug !== undefined) {
    const pred = sql<SqlBool>`v.id IN (SELECT vp.video_id FROM video_playlists vp INNER JOIN playlists p ON p.id = vp.playlist_id WHERE p.slug = ${playlistSlug})`
    query = query.where(pred)
    countQuery = countQuery.where(pred)
  }
  if (publishedAfter !== undefined) {
    query = query.where("v.published_at", ">=", publishedAfter)
    countQuery = countQuery.where("v.published_at", ">=", publishedAfter)
  }

  const rows = (await query.execute()) as Row[]
  const countRow = await countQuery.executeTakeFirstOrThrow()

  const results: FtsResult[] = rows.map((r) => ({
    youtube_video_id: r.youtube_video_id,
    title: r.title,
    thumbnail_url: r.thumbnail_url,
    start_ms: r.start_ms,
    score: r.score,
    snippet: buildSnippet(r.text, q),
  }))

  return { results, total: Number(countRow.count) }
}
