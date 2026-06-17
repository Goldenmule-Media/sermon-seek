"use client"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import type { PostIngestionResult, PreflightResponse, SlugAvailability } from "@/lib/ingest-api"
import { checkSlugAvailable, fetchChannelPreflight, postIngestionRequest } from "@/lib/ingest-api"
import type { AuthMeResponse, PlaylistFilterMode } from "@sermon-search/types"
import { useRouter } from "next/navigation"
import { useCallback, useEffect, useRef, useState } from "react"
import { ChannelPreflightCallout, type PreflightCalloutData } from "./channel-preflight-callout"
import { PlaylistPicker } from "./playlist-picker"

// --- Derived callout helpers ---

function preflightToCallout(pf: PreflightResponse | null): PreflightCalloutData {
  if (!pf) return null
  if (pf.state === "available") return { state: "available" }
  if (pf.state === "already_ingested") {
    return { state: "already_ingested", existing_slug: pf.existing_slug, search_url: pf.search_url }
  }
  if (pf.state === "request_in_flight") {
    return {
      state: "request_in_flight",
      existing_slug: pf.existing_slug,
      search_url: pf.search_url,
      is_yours: pf.is_yours,
      request_id: pf.request_id,
    }
  }
  if (pf.state === "channel_unavailable") return { state: "channel_unavailable" }
  if (pf.state === "unknown_handle") return { state: "unknown_handle" }
  return null
}

function post409ToCallout(
  result: Extract<PostIngestionResult, { status: 409 }>,
): PreflightCalloutData {
  if (result.error === "channel_already_ingested" && result.existing_slug && result.search_url) {
    return {
      state: "already_ingested",
      existing_slug: result.existing_slug,
      search_url: result.search_url,
    }
  }
  if (result.error === "channel_request_in_flight" && result.existing_slug && result.search_url) {
    return {
      state: "request_in_flight",
      existing_slug: result.existing_slug,
      search_url: result.search_url,
      is_yours: result.is_yours ?? false,
      request_id: result.request_id,
    }
  }
  if (result.error === "channel_unavailable") {
    return { state: "channel_unavailable" }
  }
  return null
}

// --- Field row ---

function Field({
  label,
  id,
  error,
  hint,
  children,
}: {
  label: string
  id: string
  error?: string
  hint?: string
  children: React.ReactNode
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-sm font-medium">
        {label}
      </label>
      {children}
      {hint && !error && <p className="text-xs text-muted-foreground">{hint}</p>}
      {error && (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
    </div>
  )
}

// --- Slug availability indicator ---

function SlugStatus({ availability }: { availability: SlugAvailability | "idle" | "checking" }) {
  if (availability === "idle" || availability === "checking") return null
  if (availability === "available") {
    return <span className="text-xs text-green-600 dark:text-green-400">Available</span>
  }
  if (availability === "taken") {
    return (
      <span role="alert" className="text-xs text-destructive">
        That slug is already taken.
      </span>
    )
  }
  if (availability === "invalid") {
    return (
      <span role="alert" className="text-xs text-destructive">
        That slug is not valid.
      </span>
    )
  }
  return null
}

// --- Main form ---

interface IngestFormProps {
  user: AuthMeResponse
}

export function IngestForm({ user: _user }: IngestFormProps) {
  const router = useRouter()

  const [slug, setSlug] = useState("")
  const [name, setName] = useState("")
  const [handle, setHandle] = useState("")
  const [email, setEmail] = useState("")
  const [filterMode, setFilterMode] = useState<PlaylistFilterMode>("none")
  const [playlistIds, setPlaylistIds] = useState<string[]>([])
  const [playlistErrors, setPlaylistErrors] = useState<Record<string, string>>({})
  const [emptyListError, setEmptyListError] = useState<string | null>(null)

  const [slugAvailability, setSlugAvailability] = useState<SlugAvailability | "idle" | "checking">(
    "idle",
  )
  const [preflight, setPreflight] = useState<PreflightResponse | null>(null)
  const [callout, setCallout] = useState<PreflightCalloutData>(null)
  const [preflightLoading, setPreflightLoading] = useState(false)

  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [retryAfter, setRetryAfter] = useState<number | null>(null)
  const [submitting, setSubmitting] = useState(false)

  // --- Slug debounce ---
  const slugTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const slugAbortRef = useRef<AbortController | null>(null)

  useEffect(() => {
    if (slugTimerRef.current) clearTimeout(slugTimerRef.current)
    if (!slug) {
      setSlugAvailability("idle")
      return
    }
    setSlugAvailability("checking")
    slugTimerRef.current = setTimeout(async () => {
      slugAbortRef.current?.abort()
      slugAbortRef.current = new AbortController()
      const result = await checkSlugAvailable(slug, slugAbortRef.current.signal)
      setSlugAvailability(result)
    }, 300)
    return () => {
      if (slugTimerRef.current) clearTimeout(slugTimerRef.current)
    }
  }, [slug])

  // --- Handle/preflight debounce ---
  const handleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const handleAbortRef = useRef<AbortController | null>(null)

  const runPreflight = useCallback(async (value: string) => {
    if (!value.trim()) {
      setPreflight(null)
      setCallout(null)
      setPreflightLoading(false)
      return
    }
    handleAbortRef.current?.abort()
    handleAbortRef.current = new AbortController()
    setPreflightLoading(true)
    const result = await fetchChannelPreflight(value.trim(), handleAbortRef.current.signal)
    setPreflightLoading(false)
    setPreflight(result)
    setCallout(preflightToCallout(result))
  }, [])

  useEffect(() => {
    if (handleTimerRef.current) clearTimeout(handleTimerRef.current)
    handleTimerRef.current = setTimeout(() => {
      void runPreflight(handle)
    }, 500)
    return () => {
      if (handleTimerRef.current) clearTimeout(handleTimerRef.current)
    }
  }, [handle, runPreflight])

  // --- Submit enable logic ---
  const requiredFilled = slug.trim() && name.trim() && handle.trim() && email.trim()
  const calloutBlocksSubmit = callout !== null && callout.state !== "available"
  const hasPlaylistErrors = Object.keys(playlistErrors).length > 0
  const includeListEmpty = filterMode === "include" && playlistIds.length === 0
  const canSubmit =
    !submitting &&
    Boolean(requiredFilled) &&
    slugAvailability === "available" &&
    preflight?.state === "available" &&
    !calloutBlocksSubmit &&
    !hasPlaylistErrors &&
    !includeListEmpty

  // --- Submit ---
  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()

    if (filterMode === "include" && playlistIds.length === 0) {
      setEmptyListError("Pick at least one playlist or switch to 'Ingest all'.")
      return
    }

    if (!canSubmit) return

    setSubmitting(true)
    setFieldErrors({})
    setSubmitError(null)
    setRetryAfter(null)

    const result = await postIngestionRequest({
      requested_slug: slug.trim(),
      requested_name: name.trim(),
      youtube_handle_or_url: handle.trim(),
      contact_email: email.trim(),
      playlist_filters: {
        mode: filterMode,
        playlist_ids: filterMode === "none" ? [] : playlistIds,
      },
    })

    setSubmitting(false)

    if (result.status === 201) {
      router.push(result.status_url)
      return
    }

    if (result.status === 409) {
      const rebuilt = post409ToCallout(result)
      setCallout(rebuilt)
      if (result.error === "slug_taken") {
        setFieldErrors({ requested_slug: "That slug is already taken." })
      }
      return
    }

    if (result.status === 400) {
      if (result.reason) {
        setFieldErrors({ requested_slug: result.reason })
      } else {
        setSubmitError(result.error)
      }
      return
    }

    if (result.status === 422) {
      if (result.error === "invalid_playlist_filters") {
        setPlaylistErrors(result.playlist_errors)
      } else {
        setFieldErrors({ youtube_handle_or_url: "We couldn't resolve that YouTube handle or URL." })
      }
      return
    }

    if (result.status === 429) {
      setRetryAfter(result.retry_after_seconds)
      return
    }

    setSubmitError("Something went wrong. Please try again.")
  }

  const showFilterSection = preflight?.state === "available"

  function handleModeChange(mode: PlaylistFilterMode) {
    setFilterMode(mode)
    setPlaylistIds([])
    setPlaylistErrors({})
    setEmptyListError(null)
  }

  function handlePlaylistChange(ids: string[]) {
    setPlaylistIds(ids)
    if (ids.length > 0) setEmptyListError(null)
    // Clear errors for IDs that were removed
    setPlaylistErrors((prev) => {
      const next = { ...prev }
      for (const key of Object.keys(next)) {
        if (!ids.includes(key)) delete next[key]
      }
      return next
    })
  }

  return (
    <main className="mx-auto max-w-xl px-4 py-16 sm:px-6">
      <h1 className="text-2xl font-semibold tracking-tight">Request a church</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        Submit your church&apos;s YouTube channel for indexing. We&apos;ll run a capped ingest and
        notify you when it&apos;s ready.
      </p>

      <form onSubmit={handleSubmit} className="mt-8 flex flex-col gap-6" noValidate>
        {/* Slug */}
        <Field
          label="URL slug"
          id="requested_slug"
          error={fieldErrors.requested_slug}
          hint="Your church will be available at /<slug>/. Letters, numbers, and hyphens only."
        >
          <Input
            id="requested_slug"
            value={slug}
            onChange={(e) => {
              setSlug(e.target.value)
              setFieldErrors((prev) => ({ ...prev, requested_slug: "" }))
            }}
            placeholder="st-mary-victories"
            autoComplete="off"
            aria-describedby="slug-status"
          />
          <span id="slug-status">
            <SlugStatus availability={slugAvailability} />
          </span>
        </Field>

        {/* Display name */}
        <Field label="Church name" id="requested_name">
          <Input
            id="requested_name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="St Mary of Victories"
          />
        </Field>

        {/* YouTube handle */}
        <Field
          label="YouTube handle or URL"
          id="youtube_handle_or_url"
          error={fieldErrors.youtube_handle_or_url}
          hint="e.g. @MyChurch or https://youtube.com/@MyChurch"
        >
          <Input
            id="youtube_handle_or_url"
            value={handle}
            onChange={(e) => {
              setHandle(e.target.value)
              setFieldErrors((prev) => ({ ...prev, youtube_handle_or_url: "" }))
              setCallout(null)
              setPreflight(null)
            }}
            placeholder="@StMaryVictories"
            autoComplete="off"
          />
          {preflightLoading && (
            <span className="text-xs text-muted-foreground">Checking channel…</span>
          )}
        </Field>

        {/* Preflight callout — rendered above submit */}
        {callout && <ChannelPreflightCallout data={callout} />}

        {/* Playlist filter section — only when channel resolves cleanly */}
        {showFilterSection && (
          <fieldset className="flex flex-col gap-3 rounded-md border px-4 py-4">
            <legend className="px-1 text-sm font-semibold">
              Limit which playlists are ingested
            </legend>
            <div
              className="flex flex-col gap-1.5"
              role="radiogroup"
              aria-label="Playlist filter mode"
            >
              {(
                [
                  { value: "none", label: "Ingest all playlists" },
                  { value: "include", label: "Only these playlists" },
                  { value: "exclude", label: "All except these playlists" },
                ] as { value: PlaylistFilterMode; label: string }[]
              ).map(({ value, label }) => (
                <label key={value} className="flex items-center gap-2 text-sm cursor-pointer">
                  <input
                    type="radio"
                    name="filter-mode"
                    value={value}
                    checked={filterMode === value}
                    onChange={() => handleModeChange(value)}
                  />
                  {label}
                </label>
              ))}
            </div>
            {(filterMode === "include" || filterMode === "exclude") && (
              <PlaylistPicker
                mode={filterMode}
                ids={playlistIds}
                onChange={handlePlaylistChange}
                errors={playlistErrors}
                onClearError={(id) =>
                  setPlaylistErrors((prev) => {
                    const next = { ...prev }
                    delete next[id]
                    return next
                  })
                }
                emptyError={emptyListError}
              />
            )}
          </fieldset>
        )}

        {/* Contact email */}
        <Field
          label="Contact email"
          id="contact_email"
          hint="We'll notify you at this address when your ingest is ready or needs review."
        >
          <Input
            id="contact_email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            autoComplete="email"
          />
        </Field>

        {/* 429 notice */}
        {retryAfter !== null && (
          <p role="alert" className="text-sm text-destructive">
            Too many requests. Please wait {retryAfter} seconds before trying again.
          </p>
        )}

        {/* Generic submit error */}
        {submitError && (
          <p role="alert" className="text-sm text-destructive">
            {submitError}
          </p>
        )}

        <Button type="submit" disabled={!canSubmit}>
          {submitting ? "Submitting…" : "Submit request"}
        </Button>
      </form>
    </main>
  )
}
