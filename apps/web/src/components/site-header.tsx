"use client"

import { Search } from "lucide-react"
import Link from "next/link"
import { useParams, usePathname } from "next/navigation"

export function SiteHeader() {
  const pathname = usePathname()
  const params = useParams<{ church?: string }>()
  const church = params?.church

  // Home page has its own hero with the wordmark — don't double up.
  if (pathname === "/") return null

  const homeHref = church ? `/${church}` : "/"

  return (
    <header className="sticky top-0 z-30 w-full border-b bg-background/80 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="mx-auto flex h-14 max-w-7xl items-center px-4 sm:px-6 lg:px-8">
        <Link
          href={homeHref}
          className="flex items-center gap-2 font-semibold tracking-tight hover:opacity-80 transition-opacity"
          aria-label="SermonSeek.ai home"
        >
          <Search className="h-5 w-5 text-primary" aria-hidden />
          <span>SermonSeek.ai</span>
        </Link>
      </div>
    </header>
  )
}
