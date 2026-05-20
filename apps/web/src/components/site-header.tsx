"use client"

import { Search } from "lucide-react"
import Link from "next/link"
import { usePathname } from "next/navigation"

export function SiteHeader() {
  const pathname = usePathname()
  // Home page has its own hero with the wordmark — don't double up.
  if (pathname === "/") return null

  return (
    <header className="sticky top-0 z-30 w-full border-b bg-background/80 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="mx-auto flex h-14 max-w-7xl items-center px-4 sm:px-6 lg:px-8">
        <Link
          href="/"
          className="flex items-center gap-2 font-semibold tracking-tight hover:opacity-80 transition-opacity"
          aria-label="Sermon Search home"
        >
          <Search className="h-5 w-5 text-primary" aria-hidden />
          <span>Sermon Search</span>
        </Link>
      </div>
    </header>
  )
}
