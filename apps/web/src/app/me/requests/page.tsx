"use client"

import { Button } from "@/components/ui/button"
import { fetchMyRequests } from "@/lib/api"
import { googleStartUrl } from "@/lib/auth"
import { useUser } from "@/lib/use-user"
import type { IngestionRequestSummary } from "@sermon-search/types"
import Link from "next/link"
import { useEffect, useState } from "react"

type LoadState = "loading" | "ready" | "error"

function statusBadge(status: IngestionRequestSummary["status"]): React.ReactNode {
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

export default function MyRequestsPage() {
  const { user, status: userStatus } = useUser()
  const [requests, setRequests] = useState<IngestionRequestSummary[]>([])
  const [loadState, setLoadState] = useState<LoadState>("loading")

  useEffect(() => {
    if (userStatus !== "ready") return
    if (!user) {
      setLoadState("ready")
      return
    }
    let cancelled = false
    fetchMyRequests().then((result) => {
      if (cancelled) return
      if (result === null) {
        setLoadState("error")
      } else {
        setRequests(result.requests)
        setLoadState("ready")
      }
    })
    return () => {
      cancelled = true
    }
  }, [user, userStatus])

  if (userStatus === "loading" || (user && loadState === "loading")) {
    return (
      <main className="mx-auto max-w-3xl px-4 py-12 sm:px-6 lg:px-8">
        <div className="h-7 w-36 bg-muted rounded animate-pulse" />
        <div className="mt-6 space-y-4">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-20 bg-muted rounded animate-pulse" />
          ))}
        </div>
      </main>
    )
  }

  if (!user) {
    return (
      <main className="mx-auto max-w-3xl px-4 py-12 sm:px-6 lg:px-8 flex flex-col items-center gap-4">
        <p className="text-muted-foreground">Sign in to view your ingestion requests.</p>
        <Button asChild size="sm">
          <a href={googleStartUrl("/me/requests")}>Sign in with Google</a>
        </Button>
      </main>
    )
  }

  if (loadState === "error") {
    return (
      <main className="mx-auto max-w-3xl px-4 py-12 sm:px-6 lg:px-8">
        <p className="text-destructive">Failed to load requests. Please try again.</p>
      </main>
    )
  }

  return (
    <main className="mx-auto max-w-3xl px-4 py-12 sm:px-6 lg:px-8">
      <h1 className="text-3xl font-bold tracking-tight">My requests</h1>
      {requests.length === 0 ? (
        <p className="mt-6 text-muted-foreground">
          You haven&apos;t submitted any ingestion requests yet.{" "}
          <Link href="/ingest" className="underline underline-offset-4 hover:text-foreground">
            Submit one now
          </Link>
          .
        </p>
      ) : (
        <ul className="mt-6 divide-y divide-border rounded-lg border">
          {requests.map((req) => (
            <li key={req.id}>
              <Link
                href={`/me/requests/${req.id}`}
                className="flex flex-col gap-1 px-4 py-4 hover:bg-accent hover:text-accent-foreground transition-colors"
              >
                <div className="flex items-center gap-2">
                  <span className="font-medium">/{req.requested_slug}/</span>
                  {statusBadge(req.status)}
                </div>
                <span className="text-sm text-muted-foreground">
                  {req.videos_ingested} / {req.videos_discovered} videos &middot;{" "}
                  {req.tokens_ingested.toLocaleString()} / {req.tokens_cap.toLocaleString()} tokens
                </span>
                <span className="text-xs text-muted-foreground">
                  {new Date(req.created_at).toLocaleString()}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </main>
  )
}
