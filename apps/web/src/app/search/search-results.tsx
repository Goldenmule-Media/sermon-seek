"use client"

import { ScriptureRefBox } from "@/components/scripture-ref-box"
import { SearchResultCard } from "@/components/search-result-card"
import { fetchSearch } from "@/lib/api"
import type { PlaylistWithStats, SearchResponse } from "@sermon-search/types"
import { useSearchParams } from "next/navigation"
import { useEffect, useState } from "react"
import { type FilterValues, SearchFilters } from "./search-filters"

interface SearchResultsProps {
  playlists: PlaylistWithStats[]
}

export function SearchResults({ playlists }: SearchResultsProps) {
  const searchParams = useSearchParams()
  const q = searchParams.get("q") ?? ""
  const ref = searchParams.get("ref") ?? ""
  const playlist = searchParams.get("playlist") ?? ""
  const from = searchParams.get("from") ?? ""
  const to = searchParams.get("to") ?? ""

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
      from: from || undefined,
      to: to || undefined,
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
  }, [q, ref, playlist, from, to])

  const filters: FilterValues = { playlist, from, to }

  return (
    <div className="space-y-4">
      <SearchFilters values={filters} playlists={playlists} />

      {!q && !ref && (
        <p className="text-muted-foreground text-sm">Enter a query above to search sermons.</p>
      )}

      {loading && <p className="text-muted-foreground text-sm">Searching…</p>}

      {error && <p className="text-destructive text-sm">Something went wrong. Please try again.</p>}

      {!loading && apiError && <p className="text-destructive text-sm">{apiError}</p>}

      {!loading && !error && !apiError && data && (
        <>
          <p className="text-sm text-muted-foreground">
            {data.total} result{data.total !== 1 ? "s" : ""} ({data.took_ms} ms)
          </p>
          <ScriptureRefBox
            refs={data.scripture_refs}
            label="Related searches"
          />
          {data.results.length === 0 ? (
            <p className="text-muted-foreground text-sm">
              {ref
                ? `No results found for scripture reference "${ref}". Try a format like "Romans 8", "John 3:16", or "1 Corinthians 13".`
                : `No results found for "${q}".`}
            </p>
          ) : (
            <ul className="space-y-3">
              {data.results.map((result) => (
                <li key={result.video_id}>
                  <SearchResultCard result={result} />
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  )
}
