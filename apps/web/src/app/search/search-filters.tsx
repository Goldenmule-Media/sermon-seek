"use client"

import { DateFilterChip } from "@/components/date-filter-chip"
import { FilterChip } from "@/components/filter-chip"
import type { PlaylistWithStats } from "@sermon-search/types"
import { useRouter, useSearchParams } from "next/navigation"

export interface FilterValues {
  playlist: string
  from: string
  to: string
}

interface SearchFiltersProps {
  values: FilterValues
  playlists: PlaylistWithStats[]
}

export function SearchFilters({ values, playlists }: SearchFiltersProps) {
  const router = useRouter()
  const searchParams = useSearchParams()

  function commit(updates: Record<string, string>) {
    const sp = new URLSearchParams(searchParams.toString())
    for (const [key, value] of Object.entries(updates)) {
      if (value) sp.set(key, value)
      else sp.delete(key)
    }
    router.replace(`/search?${sp.toString()}`)
  }

  const playlistOptions = playlists.map((p) => ({ value: p.slug, label: p.title }))

  return (
    <div className="flex flex-wrap items-center gap-2">
      <FilterChip
        label="Playlist"
        emptyLabel="All playlists"
        value={values.playlist}
        options={playlistOptions}
        onChange={(v) => commit({ playlist: v })}
        searchable
        searchPlaceholder="Search playlists"
      />
      <DateFilterChip
        from={values.from}
        to={values.to}
        onChange={(from, to) => commit({ from, to })}
      />
    </div>
  )
}
