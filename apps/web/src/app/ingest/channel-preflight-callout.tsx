"use client"

import Link from "next/link"

export type PreflightCalloutData =
  | { state: "already_ingested"; existing_slug: string; search_url: string }
  | {
      state: "request_in_flight"
      existing_slug: string
      search_url: string
      is_yours: boolean
      request_id?: string
    }
  | { state: "channel_unavailable" }
  | { state: "unknown_handle" }
  | { state: "available" }
  | null

interface Props {
  data: PreflightCalloutData
}

export function ChannelPreflightCallout({ data }: Props) {
  if (!data || data.state === "available") return null

  if (data.state === "already_ingested") {
    return (
      <output className="rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-100">
        <p>
          This channel is already on Sermon-Search.{" "}
          <Link href={data.search_url} className="font-medium underline underline-offset-2">
            Go to existing search
          </Link>
        </p>
      </output>
    )
  }

  if (data.state === "request_in_flight") {
    if (data.is_yours && data.request_id) {
      return (
        <output className="rounded-md border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-900 dark:border-blue-800 dark:bg-blue-950 dark:text-blue-100">
          <p>
            You already have an ingestion request in flight for this channel.{" "}
            <Link
              href={`/me/requests/${data.request_id}`}
              className="font-medium underline underline-offset-2"
            >
              View its status
            </Link>
          </p>
        </output>
      )
    }
    return (
      <output className="rounded-md border border-muted bg-muted/40 px-4 py-3 text-sm text-muted-foreground">
        <p>
          An ingestion request for this channel is already in progress. Please wait for it to
          complete.
        </p>
      </output>
    )
  }

  if (data.state === "channel_unavailable") {
    return (
      <output className="rounded-md border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
        <p>This channel needs admin attention before it can be re-requested.</p>
      </output>
    )
  }

  if (data.state === "unknown_handle") {
    return (
      <div
        role="alert"
        className="rounded-md border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive"
      >
        <p>We couldn&apos;t resolve that YouTube handle or URL. Check the handle and try again.</p>
      </div>
    )
  }

  return null
}
