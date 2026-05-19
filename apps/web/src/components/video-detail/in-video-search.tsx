"use client"

import { fetchVideoSearch } from "@/lib/api"
import { msToTimecode } from "@/lib/utils"
import type { SearchResult } from "@sermon-search/types"
import { useState } from "react"

interface Props {
  videoId: string
  onSeek: (ms: number) => void
}

export function InVideoSearch({ videoId, onSeek }: Props) {
  const [query, setQuery] = useState("")
  const [results, setResults] = useState<SearchResult[]>([])
  const [loading, setLoading] = useState(false)
  const [searched, setSearched] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!query.trim()) return
    setLoading(true)
    setSearched(true)
    try {
      const data = await fetchVideoSearch(videoId, query)
      setResults(data?.results ?? [])
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="space-y-2">
      <form onSubmit={handleSubmit} className="flex gap-2">
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search in this video…"
          className="flex-1 px-3 py-2 text-sm rounded-md border border-input bg-background focus:outline-none focus:ring-2 focus:ring-primary"
        />
        <button
          type="submit"
          className="px-4 py-2 text-sm font-medium bg-primary text-primary-foreground rounded-md hover:bg-primary/90 disabled:opacity-50"
          disabled={loading}
        >
          {loading ? "…" : "Search"}
        </button>
      </form>

      {searched && (
        <div className="space-y-1">
          {results.length === 0 ? (
            <p className="text-sm text-muted-foreground px-1">No results found.</p>
          ) : (
            results.map((result, i) => (
              <button
                // biome-ignore lint/suspicious/noArrayIndexKey: search results have no stable id
                key={i}
                type="button"
                onClick={() => onSeek(result.start_ms)}
                className="w-full text-left px-3 py-2 rounded-md hover:bg-muted transition-colors"
              >
                <span className="text-xs font-mono text-muted-foreground mr-2">
                  {msToTimecode(result.start_ms)}
                </span>
                <span
                  className="text-sm [&_mark]:bg-yellow-200 [&_mark]:dark:bg-yellow-800 [&_mark]:rounded [&_mark]:px-0.5"
                  // ts_headline returns only <mark> tags — safe by construction
                  // biome-ignore lint/security/noDangerouslySetInnerHtml: snippet is from ts_headline
                  dangerouslySetInnerHTML={{ __html: result.snippet }}
                />
              </button>
            ))
          )}
        </div>
      )}
    </div>
  )
}
