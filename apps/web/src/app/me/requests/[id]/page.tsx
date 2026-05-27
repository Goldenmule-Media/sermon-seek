"use client"

import { Button } from "@/components/ui/button"
import { fetchMyRequest } from "@/lib/api"
import { googleStartUrl } from "@/lib/auth"
import { useUser } from "@/lib/use-user"
import type { IngestionRequestDetail, IngestionRequestStatus } from "@sermon-search/types"
import Link from "next/link"
import { useParams } from "next/navigation"
import { useCallback, useEffect, useRef, useState } from "react"

const POLL_INTERVAL_MS = 10_000
const TERMINAL: IngestionRequestStatus[] = ["complete", "denied", "failed"]

function statusBadge(status: IngestionRequestStatus): React.ReactNode {
  const classes: Record<string, string> = {
    received: "bg-muted text-muted-foreground",
    running: "bg-muted text-muted-foreground",
    awaiting_approval: "bg-amber-100 text-amber-800",
    approved: "bg-muted text-muted-foreground",
    denied: "bg-red-100 text-red-800",
    failed: "bg-red-100 text-red-800",
    complete: "bg-green-100 text-green-800",
  }
  const label: Record<string, string> = {
    received: "received",
    running: "running",
    awaiting_approval: "awaiting approval",
    approved: "approved",
    denied: "denied",
    failed: "failed",
    complete: "complete",
  }
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${classes[status] ?? "bg-muted text-muted-foreground"}`}
    >
      {label[status] ?? status}
    </span>
  )
}

type PageState =
  | { kind: "loading" }
  | { kind: "auth" }
  | { kind: "forbidden" }
  | { kind: "detail"; data: IngestionRequestDetail }

export default function RequestDetailPage() {
  const { user, status: userStatus } = useUser()
  const params = useParams<{ id: string }>()
  const id = params?.id ?? ""

  const [pageState, setPageState] = useState<PageState>({ kind: "loading" })
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const abortRef = useRef<AbortController | null>(null)

  const load = useCallback(async () => {
    // Abort any in-flight fetch so stale responses don't overwrite newer ones.
    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller

    const { status, body } = await fetchMyRequest(id, controller.signal)
    if (controller.signal.aborted) return

    if (status === 401) {
      setPageState({ kind: "auth" })
      if (intervalRef.current) clearInterval(intervalRef.current)
      return
    }
    if (status === 403 || status === 404) {
      setPageState({ kind: "forbidden" })
      if (intervalRef.current) clearInterval(intervalRef.current)
      return
    }
    if (status === 200) {
      const detail = body as IngestionRequestDetail
      setPageState({ kind: "detail", data: detail })
      if (TERMINAL.includes(detail.status) && intervalRef.current) {
        clearInterval(intervalRef.current)
        intervalRef.current = null
      }
    }
  }, [id])

  useEffect(() => {
    if (userStatus !== "ready") return
    if (!user) {
      setPageState({ kind: "auth" })
      return
    }
    load()
    intervalRef.current = setInterval(load, POLL_INTERVAL_MS)
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current)
      abortRef.current?.abort()
    }
  }, [user, userStatus, load])

  const returnTo = `/me/requests/${id}`

  if (pageState.kind === "loading") {
    return (
      <main className="mx-auto max-w-3xl px-4 py-12 sm:px-6 lg:px-8 space-y-4">
        <div className="h-8 w-64 bg-muted rounded animate-pulse" />
        <div className="h-24 bg-muted rounded animate-pulse" />
        <div className="h-20 bg-muted rounded animate-pulse" />
      </main>
    )
  }

  if (pageState.kind === "auth") {
    return (
      <main className="mx-auto max-w-3xl px-4 py-12 sm:px-6 lg:px-8 flex flex-col items-center gap-4">
        <p className="text-muted-foreground">Sign in to view this request.</p>
        <Button asChild size="sm">
          <a href={googleStartUrl(returnTo)}>Sign in with Google</a>
        </Button>
      </main>
    )
  }

  if (pageState.kind === "forbidden") {
    return (
      <main className="mx-auto max-w-3xl px-4 py-12 sm:px-6 lg:px-8">
        <p className="text-muted-foreground">
          This request doesn&apos;t exist or isn&apos;t yours.
        </p>
      </main>
    )
  }

  const req = pageState.data
  const searchHref = req.search_url ?? `/${req.requested_slug}/`
  const isComplete = req.status === "complete"

  const videosProgress =
    req.videos_discovered > 0
      ? Math.min((req.videos_ingested / req.videos_discovered) * 100, 100)
      : 0
  const tokensProgress =
    req.tokens_cap > 0 ? Math.min((req.tokens_ingested / req.tokens_cap) * 100, 100) : 0

  return (
    <main className="mx-auto max-w-3xl px-4 py-12 sm:px-6 lg:px-8 space-y-8">
      {/* Header */}
      <div>
        <div className="flex items-center gap-2">
          <h1 className="text-3xl font-bold tracking-tight">{req.requested_name}</h1>
          {statusBadge(req.status)}
        </div>
        <p className="mt-1 text-sm text-muted-foreground">/{req.requested_slug}/</p>
      </div>

      {/* Live-link callout */}
      <div className="rounded-lg border bg-card p-4 space-y-2">
        <p className="text-sm font-medium">
          Your sermon search will live at{" "}
          <Link
            href={searchHref}
            className="font-semibold underline underline-offset-4 hover:text-primary"
          >
            {searchHref}
          </Link>
        </p>
        {isComplete ? (
          <span className="inline-flex items-center rounded-full bg-green-100 text-green-800 px-2 py-0.5 text-xs font-medium">
            live now
          </span>
        ) : (
          <p className="text-xs text-muted-foreground">
            {req.videos_discovered === 0
              ? "preparing…"
              : `indexing… ${req.videos_ingested} of ${req.videos_discovered} videos`}
          </p>
        )}
      </div>

      {/* Counters */}
      <div className="grid grid-cols-2 gap-4">
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
            Tokens
          </p>
          <p className="text-lg font-semibold">
            {req.tokens_ingested.toLocaleString()}{" "}
            <span className="text-sm font-normal text-muted-foreground">
              / {req.tokens_cap.toLocaleString()}
            </span>
          </p>
          <div className="h-1.5 w-full rounded-full bg-muted overflow-hidden">
            <div
              className="h-full rounded-full bg-primary transition-all"
              style={{ width: `${tokensProgress}%` }}
            />
          </div>
        </div>
      </div>

      {req.limit_reached && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
          Token cap reached — awaiting admin approval before ingest can continue.
        </div>
      )}

      {/* Metadata */}
      <div className="rounded-lg border divide-y text-sm">
        <div className="flex justify-between px-4 py-3">
          <span className="text-muted-foreground">YouTube</span>
          <span>{req.youtube_handle_or_url}</span>
        </div>
        <div className="flex justify-between px-4 py-3">
          <span className="text-muted-foreground">Contact email</span>
          <span>{req.contact_email}</span>
        </div>
        <div className="flex justify-between px-4 py-3">
          <span className="text-muted-foreground">Submitted</span>
          <span>{new Date(req.created_at).toLocaleString()}</span>
        </div>
        <div className="flex justify-between px-4 py-3">
          <span className="text-muted-foreground">Last updated</span>
          <span>{new Date(req.updated_at).toLocaleString()}</span>
        </div>
      </div>

      {req.admin_note && (
        <div className="rounded-lg border p-4 text-sm">
          <p className="font-medium mb-1">Admin note</p>
          <p className="text-muted-foreground">{req.admin_note}</p>
        </div>
      )}
    </main>
  )
}
