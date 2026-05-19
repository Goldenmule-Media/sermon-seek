import { SearchBox } from "@/components/search-box"
import { Suspense } from "react"
import { SearchResults } from "./search-results"

interface SearchPageProps {
  searchParams: Promise<{ q?: string }>
}

export default async function SearchPage({ searchParams }: SearchPageProps) {
  const { q } = await searchParams

  return (
    <main className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-6">
      <SearchBox initialQuery={q} />
      <Suspense fallback={<p className="text-muted-foreground text-sm">Loading…</p>}>
        <SearchResults />
      </Suspense>
    </main>
  )
}
