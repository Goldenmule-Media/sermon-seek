import type { Database } from "@sermon-search/db"
import type { Embedder } from "@sermon-search/embeddings"
import type { Kysely } from "kysely"
import { buildTsQuery } from "./build-tsquery.js"
import type { FtsResponse, FtsResult } from "./fts.js"
import { searchSegments } from "./fts.js"
import { searchSemantic } from "./semantic.js"

export const RRF_K = 60
export const FTS_WEIGHT = 1.0
// Semantic is weighted above FTS so a strong thematic hit (rank 1 in semantic, absent
// from FTS) outranks a marginal keyword hit (rank 1 in FTS, absent from semantic).
// Docs in both lists still win — they accumulate from both sides.
export const SEMANTIC_WEIGHT = 2.0
// When the user opts into a phrase via double quotes, they want literal-text
// results. Drop semantic to FTS-equivalent weight so it can only break ties /
// add adjacent related passages, not outrank verbatim phrase hits.
export const SEMANTIC_WEIGHT_WITH_PHRASE = 1.0

export interface HybridOptions {
  q: string
  videoId?: string
  limit: number
  offset: number
  topicSlug?: string
  playlistSlug?: string
  publishedAfter?: Date
  publishedBefore?: Date
}

export function fuseRRF(
  ftsResults: FtsResult[],
  semanticResults: FtsResult[],
  opts: { k?: number; ftsWeight?: number; semanticWeight?: number } = {},
): FtsResult[] {
  const k = opts.k ?? RRF_K
  const ftsWeight = opts.ftsWeight ?? FTS_WEIGHT
  const semanticWeight = opts.semanticWeight ?? SEMANTIC_WEIGHT

  const merged = new Map<string, { result: FtsResult; rrfScore: number }>()

  for (let i = 0; i < ftsResults.length; i++) {
    const r = ftsResults[i] as FtsResult
    const key = `${r.youtube_video_id}:${r.start_ms}`
    const contribution = ftsWeight / (k + i + 1)
    const existing = merged.get(key)
    if (existing) {
      existing.rrfScore += contribution
    } else {
      merged.set(key, { result: r, rrfScore: contribution })
    }
  }

  for (let i = 0; i < semanticResults.length; i++) {
    const r = semanticResults[i] as FtsResult
    const key = `${r.youtube_video_id}:${r.start_ms}`
    const contribution = semanticWeight / (k + i + 1)
    const existing = merged.get(key)
    if (existing) {
      // Accumulate score; FTS snippet already in existing.result — no override needed
      existing.rrfScore += contribution
    } else {
      merged.set(key, { result: r, rrfScore: contribution })
    }
  }

  return Array.from(merged.values())
    .sort((a, b) => b.rrfScore - a.rrfScore)
    .map(({ result, rrfScore }) => ({ ...result, score: rrfScore }))
}

export async function searchHybrid(
  db: Kysely<Database>,
  embedder: Embedder | null,
  opts: HybridOptions,
): Promise<FtsResponse> {
  const { q, videoId, limit, offset, topicSlug, playlistSlug, publishedAfter, publishedBefore } =
    opts
  const candidateLimit = Math.max(100, limit * 10)

  if (!embedder) {
    console.debug("[hybrid] embedder unavailable — degrading hybrid search to FTS-only")
    return searchSegments(db, {
      q,
      videoId,
      limit,
      offset,
      topicSlug,
      playlistSlug,
      publishedAfter,
      publishedBefore,
    })
  }

  const [ftsResponse, semanticResponse] = await Promise.all([
    searchSegments(db, {
      q,
      videoId,
      limit: candidateLimit,
      offset: 0,
      topicSlug,
      playlistSlug,
      publishedAfter,
      publishedBefore,
    }),
    searchSemantic(db, embedder, {
      q,
      videoId,
      limit: candidateLimit,
      offset: 0,
      topicSlug,
      playlistSlug,
      publishedAfter,
      publishedBefore,
    }),
  ])

  const { hasPhrases } = buildTsQuery(q)
  const semanticWeight = hasPhrases ? SEMANTIC_WEIGHT_WITH_PHRASE : SEMANTIC_WEIGHT
  const fused = fuseRRF(ftsResponse.results, semanticResponse.results, { semanticWeight })

  return { results: fused.slice(offset, offset + limit), total: fused.length }
}
