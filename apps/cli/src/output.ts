import type { AdminLogRecord } from "@sermon-search/types"
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

function hms(epochMs: number): string {
  const d = new Date(epochMs)
  const pad = (n: number) => String(n).padStart(2, "0")
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}

export function printLogRecord(rec: AdminLogRecord, opts: { json?: boolean } = {}): void {
  if (opts.json) {
    process.stdout.write(`${JSON.stringify(rec)}\n`)
    return
  }

  const fieldEntries = Object.entries(rec.fields)
  let suffix = ""
  if (fieldEntries.length > 0) {
    suffix = ` ${fieldEntries
      .map(([k, v]) => `${k}=${typeof v === "string" ? v : JSON.stringify(v)}`)
      .join(" ")}`
  }
  console.log(
    `${hms(rec.time)} ${rec.levelLabel.toUpperCase().padEnd(5)} ${rec.msg ?? ""}${suffix}`,
  )
}
