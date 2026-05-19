"use client"

import { useRouter, useSearchParams } from "next/navigation"

export interface FilterValues {
  playlist: string
  topic: string
  date: string
}

interface SearchFiltersProps {
  values: FilterValues
}

export function SearchFilters({ values }: SearchFiltersProps) {
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
      </select>

      <select
        className={selectClass}
        value={values.topic}
        onChange={(e) => update("topic", e.target.value)}
        aria-label="Filter by topic"
      >
        <option value="">All topics</option>
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
