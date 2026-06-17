#!/usr/bin/env tsx
/**
 * Sequential latency benchmark for /v1/search.
 *
 * Usage:
 *   pnpm --filter @sermon-search/api perf
 *   PORT=3001 N=200 pnpm --filter @sermon-search/api perf
 *
 * Requires the API to be running with an ingested + embedded corpus.
 *
 * Reports p50 / p95 / p99 / max (ms) per mode.
 * Exit code 1 if hybrid p95 ≥ 200ms.
 */

import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const __dirname = dirname(fileURLToPath(import.meta.url))
const PORT = process.env.PORT ?? "3001"
const BASE = `http://localhost:${PORT}/v1`
const N = Number(process.env.N ?? "200")
const P95_LIMIT_MS = 200

interface QueryEntry {
  id: string
  query: string
}

const allQueries: QueryEntry[] = JSON.parse(readFileSync(join(__dirname, "queries.json"), "utf8"))

// Use first 10 queries as the representative set; cycle if fewer.
const sample = allQueries.slice(0, 10)
if (sample.length === 0) {
  console.error("queries.json is empty")
  process.exit(1)
}

function percentile(sorted: number[], p: number): number {
  const idx = Math.ceil((p / 100) * sorted.length) - 1
  return sorted[Math.max(0, idx)] ?? 0
}

async function benchmark(mode: string): Promise<number[]> {
  const latencies: number[] = []
  // Warm-up: 5 requests not counted
  for (let i = 0; i < 5; i++) {
    const q = sample[i % sample.length] as QueryEntry
    await fetch(`${BASE}/search?q=${encodeURIComponent(q.query)}&mode=${mode}&limit=10`)
  }

  for (let i = 0; i < N; i++) {
    const q = sample[i % sample.length] as QueryEntry
    const url = `${BASE}/search?q=${encodeURIComponent(q.query)}&mode=${mode}&limit=10`
    const t0 = performance.now()
    const resp = await fetch(url)
    const elapsed = performance.now() - t0
    if (!resp.ok) {
      console.warn(`[${mode}] request ${i} returned ${resp.status}`)
    }
    latencies.push(elapsed)
  }
  return latencies
}

const MODES = ["fulltext", "semantic", "hybrid"] as const

console.log(`\nBenchmark: N=${N} sequential requests per mode, ${sample.length} query pool\n`)

const COL = 12
console.log(
  `${"mode".padEnd(COL)} ${"p50".padStart(8)} ${"p95".padStart(8)} ${"p99".padStart(8)} ${"max".padStart(8)}`,
)
console.log("─".repeat(COL + 35))

const results: Record<string, { p50: number; p95: number; p99: number; max: number }> = {}

for (const mode of MODES) {
  process.stdout.write(`  ${mode.padEnd(COL - 2)} running...`)
  let latencies: number[]
  try {
    latencies = await benchmark(mode)
  } catch (err) {
    console.error(`\n[${mode}] benchmark failed:`, err)
    continue
  }
  const sorted = latencies.slice().sort((a, b) => a - b)
  const p50 = percentile(sorted, 50)
  const p95 = percentile(sorted, 95)
  const p99 = percentile(sorted, 99)
  const max = sorted[sorted.length - 1] ?? 0
  results[mode] = { p50, p95, p99, max }
  process.stdout.write("\r")
  const fmt = (n: number) => `${n.toFixed(1)}ms`
  console.log(
    `${mode.padEnd(COL)} ${fmt(p50).padStart(8)} ${fmt(p95).padStart(8)} ${fmt(p99).padStart(8)} ${fmt(max).padStart(8)}`,
  )
}

console.log()

const hybridP95 = results.hybrid?.p95
if (hybridP95 === undefined) {
  console.error("hybrid benchmark did not complete")
  process.exit(1)
}

if (hybridP95 >= P95_LIMIT_MS) {
  console.error(`FAIL — hybrid p95 ${hybridP95.toFixed(1)}ms ≥ ${P95_LIMIT_MS}ms target`)
  process.exit(1)
}
console.log(`PASS — hybrid p95 ${hybridP95.toFixed(1)}ms < ${P95_LIMIT_MS}ms target`)
