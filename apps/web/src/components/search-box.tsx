"use client"

import { Button } from "@/components/ui/button"
import { isRefLike } from "@/lib/scripture-ref-detect"
import Link from "next/link"
import { useRouter, useSearchParams } from "next/navigation"
import { type ReactNode, useEffect, useState } from "react"

const SUGGESTIONS = ["armor of god", "Romans 8", "how are elders chosen?"]

function suggestionHref(church: string, q: string): string {
  const param = isRefLike(q) ? "ref" : "q"
  return `/${church}/search?${param}=${encodeURIComponent(q)}`
}

interface SearchBoxProps {
  church: string
  initialQuery?: string
  showHint?: boolean
  // Optional content rendered inside the input's field area (right side),
  // e.g. icon-only filter triggers. The field itself loses its own border so
  // the filters appear flush inside it.
  filtersSlot?: ReactNode
}

export function SearchBox({ church, initialQuery, showHint = true, filtersSlot }: SearchBoxProps) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const urlQuery = searchParams?.get("q") ?? searchParams?.get("ref") ?? ""
  const [query, setQuery] = useState(initialQuery ?? urlQuery)

  // Keep the input in sync with the URL when navigation happens outside the
  // form (e.g. clicking a scripture-ref chip in a result card).
  useEffect(() => {
    setQuery(urlQuery)
  }, [urlQuery])

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const q = query.trim()
    if (!q) return
    if (isRefLike(q)) {
      router.push(`/${church}/search?ref=${encodeURIComponent(q)}`)
    } else {
      router.push(`/${church}/search?q=${encodeURIComponent(q)}`)
    }
  }

  return (
    <div className="w-full space-y-2">
      <form onSubmit={handleSubmit} className="flex gap-2">
        <div className="flex-1 flex items-center h-12 rounded-md border border-input bg-background ring-offset-background focus-within:outline-none focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-2">
          <input
            // biome-ignore lint/a11y/noAutofocus: the search bar is the primary action on these pages
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search sermons..."
            className="flex-1 min-w-0 h-full bg-transparent border-0 outline-none px-3 text-base placeholder:text-muted-foreground"
          />
          {filtersSlot && (
            <div className="flex items-center gap-0.5 pr-1.5 shrink-0">{filtersSlot}</div>
          )}
        </div>
        <Button type="submit" className="h-12 px-6">
          Search
        </Button>
      </form>
      {showHint && (
        <p className="text-sm text-muted-foreground text-center">
          try:{" "}
          {SUGGESTIONS.map((s, i) => (
            <span key={s}>
              {i > 0 && ", "}
              <Link href={suggestionHref(church, s)} className="text-primary hover:underline">
                {s}
              </Link>
            </span>
          ))}
        </p>
      )}
    </div>
  )
}
