#!/usr/bin/env tsx
/**
 * Held-out query scorer — runs against a live local API.
 *
 * Usage:
 *   pnpm --filter @sermon-search/api eval
 *   PORT=3001 pnpm --filter @sermon-search/api eval
 *
 * Requires the API to be running with an ingested + embedded corpus.
 * Queries in queries.json with expected.youtube_video_id === "REPLACE_AFTER_INGEST"
 * are skipped (not counted toward recall).
 *
 * Exit codes:
 *   0  — hybrid top-3 recall ≥ 80% (or no calibrated queries yet)
 *   1  — hybrid top-3 recall < 80%
 */

import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const __dirname = dirname(fileURLToPath(import.meta.url))
const PORT = process.env.PORT ?? "3001"
const BASE = `http://localhost:${PORT}/v1`
const LIMIT = 10
const TOP_K_PASS = 3
const PASS_THRESHOLD = 0.8

interface QueryEntry {
  id: string
  query: string
  expected: {
    youtube_video_id: string
    start_ms_min: number
    start_ms_max: number
  }
  kind: "exact" | "paraphrase" | "concept"
  notes: string
}

interface SearchResult {
  video_id: string
  start_ms: number
}

interface SearchResponse {
  results: SearchResult[]
  total: number
  took_ms: number
}

const queries: QueryEntry[] = JSON.parse(readFileSync(join(__dirname, "queries.json"), "utf8"))

const calibrated = queries.filter((q) => q.expected.youtube_video_id !== "REPLACE_AFTER_INGEST")

if (calibrated.length === 0) {
  console.log(
    "No calibrated queries found. Populate expected.youtube_video_id in eval/queries.json first.",
  )
  process.exit(0)
}

async function fetchResults(query: string, mode: string): Promise<SearchResult[]> {
  const url = `${BASE}/search?q=${encodeURIComponent(query)}&mode=${mode}&limit=${LIMIT}`
  const resp = await fetch(url)
  if (!resp.ok) {
    throw new Error(`${mode} search failed: ${resp.status} ${await resp.text()}`)
  }
  const body = (await resp.json()) as SearchResponse
  return body.results
}

function isHit(results: SearchResult[], expected: QueryEntry["expected"], topK: number): boolean {
  return results
    .slice(0, topK)
    .some(
      (r) =>
        r.video_id === expected.youtube_video_id &&
        r.start_ms >= expected.start_ms_min &&
        r.start_ms <= expected.start_ms_max,
    )
}

const MODES = ["fulltext", "semantic", "hybrid"] as const

type RecallRow = { top1: number; top3: number; top10: number }
const recall: Record<string, RecallRow> = {}

for (const mode of MODES) {
  let top1 = 0
  let top3 = 0
  let top10 = 0

  for (const q of calibrated) {
    let results: SearchResult[]
    try {
      results = await fetchResults(q.query, mode)
    } catch (err) {
      console.error(`[${mode}] query "${q.id}" failed:`, err)
      continue
    }
    if (isHit(results, q.expected, 1)) top1++
    if (isHit(results, q.expected, 3)) top3++
    if (isHit(results, q.expected, 10)) top10++
  }

  recall[mode] = {
    top1: top1 / calibrated.length,
    top3: top3 / calibrated.length,
    top10: top10 / calibrated.length,
  }
}

const pct = (n: number) => `${(n * 100).toFixed(1)}%`
const COL = 12

console.log(`\nHeld-out query set: ${calibrated.length} calibrated queries\n`)
console.log(
  `${"mode".padEnd(COL)} ${"top-1".padStart(8)} ${"top-3".padStart(8)} ${"top-10".padStart(8)}`,
)
console.log("─".repeat(COL + 27))
for (const mode of MODES) {
  const r = recall[mode]
  if (!r) continue
  console.log(
    `${mode.padEnd(COL)} ${pct(r.top1).padStart(8)} ${pct(r.top3).padStart(8)} ${pct(r.top10).padStart(8)}`,
  )
}
console.log()

const hybridTop3 = recall.hybrid?.top3 ?? 0
if (hybridTop3 < PASS_THRESHOLD) {
  console.error(
    `FAIL — hybrid top-${TOP_K_PASS} recall ${pct(hybridTop3)} < ${pct(PASS_THRESHOLD)} target`,
  )
  process.exit(1)
}
console.log(`PASS — hybrid top-${TOP_K_PASS} recall ${pct(hybridTop3)} ≥ ${pct(PASS_THRESHOLD)}`)
