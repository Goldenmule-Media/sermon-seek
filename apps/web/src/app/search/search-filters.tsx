"use client"

import type { PlaylistWithStats } from "@sermon-search/types"
import { useRouter, useSearchParams } from "next/navigation"

export interface FilterValues {
  playlist: string
  date: string
}

interface SearchFiltersProps {
  values: FilterValues
  playlists: PlaylistWithStats[]
}

export function SearchFilters({ values, playlists }: SearchFiltersProps) {
  const router = useRouter()
  const searchParams = useSearchParams()

  function update(key: keyof FilterValues, value: string) {
    const sp = new URLSearchParams(searchParams.toString())
    if (value) {
      sp.set(key, value)
    } else {
      sp.delete(key)
    }
    router.replace(`/search?${sp.toString()}`)
  }

  const selectClass =
    "h-9 rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm focus:outline-none focus:ring-1 focus:ring-ring"

  return (
    <div className="flex flex-wrap gap-3">
      <select
        className={selectClass}
        value={values.playlist}
        onChange={(e) => update("playlist", e.target.value)}
        aria-label="Filter by playlist"
      >
        <option value="">All playlists</option>
        {playlists.map((p) => (
          <option key={p.slug} value={p.slug}>
            {p.title}
          </option>
        ))}
      </select>

      <select
        className={selectClass}
        value={values.date}
        onChange={(e) => update("date", e.target.value)}
        aria-label="Filter by date"
      >
        <option value="">Any time</option>
        <option value="year">Past year</option>
        <option value="month">Past 30 days</option>
      </select>
    </div>
  )
}
