import { SearchBox } from "@/components/search-box"
import { fetchPlaylists, fetchTopics } from "@/lib/api"
import { Suspense } from "react"
import { SearchResults } from "./search-results"

interface SearchPageProps {
  searchParams: Promise<{ q?: string; ref?: string }>
}

export default async function SearchPage({ searchParams }: SearchPageProps) {
  const { q, ref } = await searchParams
  const [topics, playlists] = await Promise.all([fetchTopics(), fetchPlaylists()])

  return (
    <main className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-6">
      <SearchBox initialQuery={q ?? ref} />
      <Suspense fallback={<p className="text-muted-foreground text-sm">Loading…</p>}>
        <SearchResults topics={topics} playlists={playlists} />
      </Suspense>
    </main>
  )
}
