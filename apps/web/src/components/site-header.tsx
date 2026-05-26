"use client"

import { Search } from "lucide-react"
import Link from "next/link"
import { useParams, usePathname } from "next/navigation"
import { Suspense } from "react"
import { UserMenu } from "./user-menu"

export function SiteHeader() {
  const pathname = usePathname()
  const params = useParams<{ church?: string }>()
  const church = params?.church

  const homeHref = church ? `/${church}` : "/"
  const showBrand = pathname !== "/"

  return (
    <header className="sticky top-0 z-30 w-full border-b bg-background/80 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="mx-auto flex h-14 max-w-7xl items-center px-4 sm:px-6 lg:px-8">
        {showBrand && (
          <Link
            href={homeHref}
            className="flex items-center gap-2 font-semibold tracking-tight hover:opacity-80 transition-opacity"
            aria-label="SermonSeek.ai home"
          >
            <Search className="h-5 w-5 text-primary" aria-hidden />
            <span>SermonSeek.ai</span>
          </Link>
        )}
        <div className="ml-auto">
          <Suspense fallback={<div className="h-8 w-16" aria-hidden />}>
            <UserMenu />
          </Suspense>
        </div>
      </div>
    </header>
  )
}
