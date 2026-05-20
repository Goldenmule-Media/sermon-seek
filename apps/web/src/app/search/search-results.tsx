"use client"

import { SearchResultCard } from "@/components/search-result-card"
import { fetchSearch } from "@/lib/api"
import type { PlaylistWithStats, SearchResponse, Topic } from "@sermon-search/types"
import { useSearchParams } from "next/navigation"
import { useEffect, useState } from "react"
import { type FilterValues, SearchFilters } from "./search-filters"

interface SearchResultsProps {
  topics: Topic[]
  playlists: PlaylistWithStats[]
}

export function SearchResults({ topics, playlists }: SearchResultsProps) {
  const searchParams = useSearchParams()
  const q = searchParams.get("q") ?? ""
  const ref = searchParams.get("ref") ?? ""
  const playlist = searchParams.get("playlist") ?? ""
  const topic = searchParams.get("topic") ?? ""
  const date = searchParams.get("date") ?? ""

  const [data, setData] = useState<SearchResponse | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(false)
  const [apiError, setApiError] = useState<string | null>(null)

  useEffect(() => {
    if (!q && !ref) {
      setData(null)
      return
    }
    let cancelled = false
    setLoading(true)
    setError(false)
    setApiError(null)
    fetchSearch({
      q: q || undefined,
      ref: ref || undefined,
      playlist: playlist || undefined,
      topic: topic || undefined,
      date: date || undefined,
      limit: 20,
      offset: 0,
    })
      .then((res) => {
        if (cancelled) return
        if ("error" in res) {
          setApiError(res.error)
          setData(null)
        } else {
          setData(res)
        }
      })
      .catch(() => {
        if (!cancelled) setError(true)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [q, ref, playlist, topic, date])

  const filters: FilterValues = { playlist, topic, date }

  return (
    <div className="space-y-4">
      <SearchFilters values={filters} topics={topics} playlists={playlists} />

      {!q && !ref && (
        <p className="text-muted-foreground text-sm">Enter a query above to search sermons.</p>
      )}

      {loading && <p className="text-muted-foreground text-sm">Searching…</p>}

      {error && <p className="text-destructive text-sm">Something went wrong. Please try again.</p>}

      {!loading && apiError && <p className="text-destructive text-sm">{apiError}</p>}

      {!loading && !error && !apiError && data && (
        <>
          {ref && (
            <p className="text-sm text-muted-foreground">
              Searching scripture references for &ldquo;{ref}&rdquo;
            </p>
          )}
          <p className="text-sm text-muted-foreground">
            {data.total} result{data.total !== 1 ? "s" : ""} ({data.took_ms} ms)
          </p>
          {data.results.length === 0 ? (
            <p className="text-muted-foreground text-sm">
              {ref
                ? `No results found for scripture reference "${ref}". Try a format like "Romans 8", "John 3:16", or "1 Corinthians 13".`
                : `No results found for "${q}".`}
            </p>
          ) : (
            <ul className="space-y-3">
              {data.results.map((result, i) => (
                <li key={`${result.video_id}-${result.start_ms}-${i}`}>
                  <SearchResultCard result={result} hasTimestamp={!ref} />
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  )
}
