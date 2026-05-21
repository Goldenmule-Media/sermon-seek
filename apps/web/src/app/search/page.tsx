import { fetchPlaylists } from "@/lib/api"
import { Suspense } from "react"
import { SearchResults } from "./search-results"

interface SearchPageProps {
  searchParams: Promise<{ q?: string; ref?: string }>
}

export default async function SearchPage({ searchParams }: SearchPageProps) {
  const { q, ref } = await searchParams
  const playlists = await fetchPlaylists()

  return (
    <main className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-6">
      <Suspense fallback={<p className="text-muted-foreground text-sm">Loading…</p>}>
        <SearchResults playlists={playlists} initialQuery={q ?? ref} />
      </Suspense>
    </main>
  )
}
