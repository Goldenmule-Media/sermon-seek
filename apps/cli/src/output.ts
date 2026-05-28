import type { AdminLogRecord } from "@sermon-search/types"
import type {
  AuditEntry,
  AuditListResponse,
  ChannelAddResponse,
  ChannelRefreshResponse,
  ChannelViewStatsResponse,
  ChurchDetail,
  ChurchVideosResponse,
  ChurchesListResponse,
  HealthResponse,
  RequestDetail,
  RequestsListResponse,
} from "./client.js"

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

// Generic column-padded table printer
export function printTable(headers: string[], rows: string[][]): void {
  const allRows = [headers, ...rows]
  const widths = headers.map((_, i) => Math.max(...allRows.map((r) => (r[i] ?? "").length)))
  const line = (row: string[]) =>
    row.map((cell, i) => (cell ?? "").padEnd(widths[i] ?? 0)).join("  ")
  console.log(line(headers))
  console.log(widths.map((w) => "-".repeat(w)).join("  "))
  for (const row of rows) {
    console.log(line(row))
  }
}

// ── Churches ────────────────────────────────────────────────────────────────

export function printChurchList(data: ChurchesListResponse): void {
  console.log(`Total: ${data.total}`)
  if (data.items.length === 0) {
    console.log("No churches.")
    return
  }
  printTable(
    ["ID", "Slug", "Name", "Status", "Channels", "Videos", "Created"],
    data.items.map((c) => [
      c.id,
      c.slug,
      c.name,
      c.status,
      String(c.channel_count),
      String(c.video_count),
      c.created_at.slice(0, 10),
    ]),
  )
}

export function printChurchDetail(data: ChurchDetail): void {
  console.log(`ID:         ${data.id}`)
  console.log(`Slug:       ${data.slug}`)
  console.log(`Name:       ${data.name}`)
  console.log(`Status:     ${data.status}`)
  console.log(`YT Channel: ${data.youtube_channel_id ?? "(none)"}`)
  console.log(`Created:    ${data.created_at}`)
  console.log(`Channels:   ${data.channel_count}  Videos: ${data.video_count}`)
  if (data.channels.length > 0) {
    console.log("")
    console.log("Channels:")
    printTable(
      ["ID", "YT Channel ID", "Title", "Ingested"],
      data.channels.map((c) => [c.id, c.youtube_channel_id, c.title, c.ingested_at.slice(0, 10)]),
    )
  }
  if (data.aliases.length > 0) {
    console.log("")
    console.log("Aliases:")
    printTable(
      ["ID", "Slug", "Created", "Expires"],
      data.aliases.map((a) => [
        a.id,
        a.slug,
        a.created_at.slice(0, 10),
        a.expires_at ? a.expires_at.slice(0, 10) : "(never)",
      ]),
    )
  }
}

export function printChurchVideos(data: ChurchVideosResponse): void {
  console.log(
    `Total: ${data.total}  (showing ${data.offset + 1}–${data.offset + data.items.length})`,
  )
  if (data.items.length === 0) {
    console.log("No videos.")
    return
  }
  printTable(
    ["ID", "YT Video ID", "Title", "Published", "Transcript"],
    data.items.map((v) => [
      v.id,
      v.youtube_id,
      v.title.slice(0, 40),
      v.published_at ? v.published_at.slice(0, 10) : "(none)",
      v.has_transcript ? "yes" : "no",
    ]),
  )
}

// ── Requests ─────────────────────────────────────────────────────────────────

export function printRequestList(data: RequestsListResponse): void {
  console.log(`Total: ${data.total}`)
  if (data.requests.length === 0) {
    console.log("No requests.")
    return
  }
  printTable(
    ["ID", "Slug", "User", "Status", "Videos", "Created"],
    data.requests.map((r) => [
      r.id,
      r.requested_slug,
      r.display_name ?? r.user_id.slice(0, 8),
      r.status,
      String(r.videos_ingested),
      r.created_at.slice(0, 10),
    ]),
  )
}

export function printRequestDetail(data: RequestDetail): void {
  console.log(`ID:            ${data.id}`)
  console.log(`Status:        ${data.status}`)
  console.log(`Requested slug:${data.requested_slug}`)
  console.log(`Requested name:${data.requested_name}`)
  console.log(`Contact email: ${data.contact_email}`)
  console.log(`YT handle/URL: ${data.youtube_handle_or_url}`)
  console.log(`Church slug:   ${data.church_slug ?? "(none)"}`)
  console.log(`Church status: ${data.church_status ?? "(none)"}`)
  console.log(`Videos discovered: ${data.videos_discovered}  ingested: ${data.videos_ingested}`)
  console.log(`Tokens ingested:   ${data.tokens_ingested} / ${data.tokens_cap}`)
  if (data.admin_note) console.log(`Admin note:    ${data.admin_note}`)
  console.log(`Created: ${data.created_at}  Updated: ${data.updated_at}`)
  if (data.discovered_playlists.length > 0) {
    console.log("")
    console.log("Discovered playlists:")
    printTable(
      ["ID", "Slug", "Title", "Videos"],
      data.discovered_playlists.map((p) => [
        p.id,
        p.slug,
        p.title,
        p.video_count != null ? String(p.video_count) : "?",
      ]),
    )
  }
}

// ── Channels ─────────────────────────────────────────────────────────────────

export function printChannel(data: ChannelAddResponse): void {
  console.log(`ID:            ${data.id}`)
  console.log(`YT Channel ID: ${data.youtube_channel_id}`)
  console.log(`Title:         ${data.title}`)
  console.log(`Ingested:      ${data.ingested_at}`)
}

export function printRefresh(data: ChannelRefreshResponse): void {
  if (data.channels.length === 0) {
    console.log("No channels refreshed.")
    return
  }
  printTable(
    ["YT Channel ID", "Playlists", "Videos"],
    data.channels.map((c) => [c.youtubeChannelId, String(c.playlistCount), String(c.videoCount)]),
  )
}

export function printViewStats(data: ChannelViewStatsResponse): void {
  console.log(`Channels:        ${data.channelCount}`)
  console.log(`Playlists:       ${data.playlistCount}`)
  console.log(`Videos:          ${data.videoCount}`)
  console.log(`Fetched from API:${data.fetchedFromApi}`)
}

// ── Audit ────────────────────────────────────────────────────────────────────

export function printAuditEntry(entry: AuditEntry): void {
  const actor = entry.user_display_name ?? entry.user_id ?? "cli"
  console.log(
    `${entry.created_at.slice(0, 19)}  ${entry.action.padEnd(30)}  ${entry.target_type}/${entry.target_id.slice(0, 8)}  ${actor}`,
  )
}

export function printAuditList(data: AuditListResponse): void {
  console.log(`Total: ${data.total}`)
  if (data.items.length === 0) {
    console.log("No audit entries.")
    return
  }
  for (const entry of data.items) {
    printAuditEntry(entry)
  }
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
