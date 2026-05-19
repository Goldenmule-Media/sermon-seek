"use client"

import { SearchResultCard } from "@/components/search-result-card"
import { fetchSearch } from "@/lib/api"
import type { SearchResponse } from "@sermon-search/types"
import { useSearchParams } from "next/navigation"
import { useEffect, useState } from "react"
import { type FilterValues, SearchFilters } from "./search-filters"

export function SearchResults() {
  const searchParams = useSearchParams()
  const q = searchParams.get("q") ?? ""
  const playlist = searchParams.get("playlist") ?? ""
  const topic = searchParams.get("topic") ?? ""
  const date = searchParams.get("date") ?? ""

  const [data, setData] = useState<SearchResponse | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(false)

  useEffect(() => {
    if (!q) {
      setData(null)
      return
    }
    let cancelled = false
    setLoading(true)
    setError(false)
    fetchSearch({
      q,
      playlist: playlist || undefined,
      topic: topic || undefined,
      limit: 20,
      offset: 0,
    })
      .then((res) => {
        if (!cancelled) setData(res)
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
  }, [q, playlist, topic])

  const filters: FilterValues = { playlist, topic, date }

  return (
    <div className="space-y-4">
      <SearchFilters values={filters} />

      {!q && (
        <p className="text-muted-foreground text-sm">Enter a query above to search sermons.</p>
      )}

      {loading && <p className="text-muted-foreground text-sm">Searching…</p>}

      {error && <p className="text-destructive text-sm">Something went wrong. Please try again.</p>}

      {!loading && !error && data && (
        <>
          <p className="text-sm text-muted-foreground">
            {data.total} result{data.total !== 1 ? "s" : ""} ({data.took_ms} ms)
          </p>
          {data.results.length === 0 ? (
            <p className="text-muted-foreground text-sm">No results found for &ldquo;{q}&rdquo;.</p>
          ) : (
            <ul className="space-y-3">
              {data.results.map((result, i) => (
                <li key={`${result.video_id}-${result.start_ms}-${i}`}>
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
