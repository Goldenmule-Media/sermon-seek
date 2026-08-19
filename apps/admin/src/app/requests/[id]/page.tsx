import { fetchAdminRequest } from "@/lib/api"
import type { AdminRequestDetail, IngestionRequestStatus } from "@/lib/api"
import { StatusBadge } from "@/lib/status-badge"
import Link from "next/link"
import { notFound } from "next/navigation"
import { ApproveDenyButtons } from "./approve-deny-buttons"
import { PlaylistFiltersPanel } from "./playlist-filters-panel"

interface Props {
  params: Promise<{ id: string }>
}

const TERMINAL_STATUSES: IngestionRequestStatus[] = ["complete", "denied", "approved"]

// --- Stage outcome helpers ---

interface Stage {
  key: string
  label: string
  state: "done" | "current" | "pending" | "skipped"
}

function deriveStages(req: AdminRequestDetail): Stage[] {
  const s = req.status
  const stages: Stage[] = [
    {
      key: "received",
      label: "Received",
      state: "done",
    },
    {
      key: "discovery",
      label: "Discovery",
      state: req.videos_discovered > 0 ? "done" : s === "running" ? "current" : "pending",
    },
    {
      key: "ingesting",
      label: "Ingesting",
      state:
        req.videos_ingested > 0
          ? "done"
          : s === "running" && req.videos_discovered > 0
            ? "current"
            : "pending",
    },
    {
      key: "awaiting_approval",
      label: "Awaiting approval",
      state:
        s === "awaiting_approval"
          ? "current"
          : req.limit_reached || ["approved", "complete"].includes(s)
            ? "done"
            : "pending",
    },
    {
      key: "complete",
      label: "Complete",
      state: s === "complete" ? "done" : "pending",
    },
  ]

  if (s === "denied") {
    stages.push({ key: "denied", label: "Denied", state: "current" })
  }
  if (s === "failed") {
    stages.push({ key: "failed", label: "Failed", state: "current" })
  }

  return stages
}

function StageIcon({ state }: { state: Stage["state"] }) {
  if (state === "done") return <span className="text-green-600 font-bold">✓</span>
  if (state === "current") return <span className="text-amber-600 font-bold">●</span>
  if (state === "skipped") return <span className="text-muted-foreground">—</span>
  return <span className="text-muted-foreground">○</span>
}

export default async function RequestDetailPage({ params }: Props) {
  const { id } = await params
  const req = await fetchAdminRequest(id)
  if (!req) notFound()

  const videosProgress =
    req.videos_discovered > 0
      ? Math.min((req.videos_ingested / req.videos_discovered) * 100, 100)
      : 0
  const tokensProgress =
    req.tokens_cap > 0 ? Math.min((req.tokens_ingested / req.tokens_cap) * 100, 100) : 0

  const stages = deriveStages(req)
  const isTerminal = TERMINAL_STATUSES.includes(req.status)

  return (
    <main className="mx-auto max-w-3xl px-4 py-10 sm:px-6 lg:px-8 space-y-8">
      {/* Back link */}
      <Link
        href="/requests"
        className="text-sm text-muted-foreground hover:text-foreground transition-colors"
      >
        ← All requests
      </Link>

      {/* Header */}
      <div>
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-2xl font-semibold tracking-tight">{req.requested_name}</h1>
          <StatusBadge status={req.status} />
          {req.ingest_mode === "incremental" && (
            <span className="inline-flex items-center rounded bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-700">
              incremental
            </span>
          )}
        </div>
        <p className="mt-1 text-sm text-muted-foreground">
          /{req.requested_slug}/ &middot; updated {new Date(req.updated_at).toLocaleString()}
        </p>
      </div>

      {/* Submitter */}
      <section className="rounded-lg border divide-y text-sm">
        <div className="px-4 py-3 flex justify-between gap-4">
          <span className="text-muted-foreground shrink-0">Submitter</span>
          <span className="text-right">
            {req.display_name ?? <span className="font-mono">{req.user_id}</span>}
          </span>
        </div>
        <div className="px-4 py-3 flex justify-between gap-4">
          <span className="text-muted-foreground shrink-0">Contact email</span>
          <span className="text-right">{req.contact_email}</span>
        </div>
      </section>

      {/* Channel info */}
      <section className="rounded-lg border divide-y text-sm">
        <div className="px-4 py-3 flex justify-between gap-4">
          <span className="text-muted-foreground shrink-0">YouTube handle / URL</span>
          <span className="text-right break-all">{req.youtube_handle_or_url}</span>
        </div>
        {req.youtube_channel_id && (
          <div className="px-4 py-3 flex justify-between gap-4">
            <span className="text-muted-foreground shrink-0">Channel ID</span>
            <span className="text-right font-mono text-xs">{req.youtube_channel_id}</span>
          </div>
        )}
        {req.channel_title && (
          <div className="px-4 py-3 flex justify-between gap-4">
            <span className="text-muted-foreground shrink-0">Channel title</span>
            <span className="text-right">{req.channel_title}</span>
          </div>
        )}
        {req.church_slug && (
          <div className="px-4 py-3 flex justify-between gap-4">
            <span className="text-muted-foreground shrink-0">Church slug</span>
            <span className="text-right">
              /{req.church_slug}/{" "}
              {req.church_status && (
                <span className="text-xs text-muted-foreground">({req.church_status})</span>
              )}{" "}
              <Link
                href={`/churches?slug_prefix=${encodeURIComponent(req.church_slug)}`}
                className="text-xs underline text-muted-foreground hover:text-foreground"
              >
                Manage church
              </Link>
            </span>
          </div>
        )}
      </section>

      {/* Counters / progress */}
      <section className="grid grid-cols-2 gap-4">
        <div className="rounded-lg border p-4 space-y-2">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Videos
          </p>
          <p className="text-lg font-semibold">
            {req.videos_ingested}{" "}
            <span className="text-sm font-normal text-muted-foreground">
              / {req.videos_discovered}
            </span>
          </p>
          <div className="h-1.5 w-full rounded-full bg-muted overflow-hidden">
            <div
              className="h-full rounded-full bg-primary transition-all"
              style={{ width: `${videosProgress}%` }}
            />
          </div>
        </div>
        <div className="rounded-lg border p-4 space-y-2">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Token cap
          </p>
          <p className="text-lg font-semibold">
            {req.tokens_ingested.toLocaleString()}{" "}
            <span className="text-sm font-normal text-muted-foreground">
              / {req.tokens_cap.toLocaleString()}
            </span>
          </p>
          <div className="h-1.5 w-full rounded-full bg-muted overflow-hidden">
            <div
              className={`h-full rounded-full transition-all ${tokensProgress >= 100 ? "bg-amber-500" : "bg-primary"}`}
              style={{ width: `${tokensProgress}%` }}
            />
          </div>
        </div>
      </section>

      {req.limit_reached && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
          Token cap reached — awaiting admin approval before ingest can continue.
        </div>
      )}

      {/* Stage outcomes */}
      <section className="rounded-lg border p-4">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground mb-3">
          Stages
        </p>
        <ul className="space-y-2">
          {stages.map((stage) => (
            <li
              key={stage.key}
              className={`flex items-center gap-3 text-sm ${stage.state === "current" ? "font-semibold" : stage.state === "pending" ? "text-muted-foreground" : ""}`}
            >
              <StageIcon state={stage.state} />
              {stage.label}
            </li>
          ))}
        </ul>
      </section>

      {/* Discovered playlists */}
      <section className="space-y-2">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Discovered playlists
        </p>
        {req.discovered_playlists.length === 0 ? (
          <p className="text-sm text-muted-foreground">No playlists discovered yet.</p>
        ) : (
          <div className="rounded-lg border overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-muted/50">
                <tr>
                  <th className="px-4 py-2 text-left font-medium text-muted-foreground">Title</th>
                  <th className="px-4 py-2 text-left font-medium text-muted-foreground">Slug</th>
                  <th className="px-4 py-2 text-right font-medium text-muted-foreground">Videos</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {req.discovered_playlists.map((pl) => (
                  <tr key={pl.id}>
                    <td className="px-4 py-2">{pl.title}</td>
                    <td className="px-4 py-2 text-muted-foreground">{pl.slug}</td>
                    <td className="px-4 py-2 text-right tabular-nums">{pl.video_count ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Admin note */}
      {req.admin_note && (
        <section className="rounded-lg border p-4 text-sm space-y-1">
          <p className="font-medium">Admin note</p>
          <p className="text-muted-foreground">{req.admin_note}</p>
        </section>
      )}

      {/* Playlist filters */}
      <PlaylistFiltersPanel filters={req.playlist_filters} />

      {/* Actions */}
      {!isTerminal && (
        <section className="space-y-2">
          <ApproveDenyButtons
            requestId={req.id}
            status={req.status}
            playlistFilters={req.playlist_filters}
          />
        </section>
      )}
    </main>
  )
}
