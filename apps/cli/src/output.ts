import type { HealthResponse } from "./client.js"

export function printJson(data: unknown): void {
  console.log(JSON.stringify(data, null, 2))
}

export function printHealth(data: HealthResponse): void {
  const workerCount = data.workers.length
  const stale = data.workers.filter((w) => w.stale).length
  if (workerCount === 0) {
    console.log("Workers: none registered")
  } else {
    console.log(`Workers: ${workerCount} (${stale} stale)`)
    for (const w of data.workers) {
      const flag = w.stale ? " [STALE]" : ""
      console.log(`  ${w.kind}/${w.worker_id}  ${w.status}${flag}  last_beat=${w.last_beat_at}`)
    }
  }
  const fmt = (s: { last_run_at: string | null; last_status: string | null }) =>
    s.last_run_at ? `${s.last_run_at} (${s.last_status ?? "?"})` : "never"
  console.log(`View-stats: ${fmt(data.view_stats)}`)
  console.log(`Smoke-test: ${fmt(data.smoke_test)}`)
}
