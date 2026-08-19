"use client"

import { cn } from "@/lib/utils"
import Link from "next/link"
import { usePathname } from "next/navigation"

const LINKS = [
  { href: "/", label: "Dashboard" },
  { href: "/requests", label: "Requests" },
  { href: "/churches", label: "Churches" },
  { href: "/videos", label: "Videos" },
  { href: "/audit", label: "Audit" },
  { href: "/health", label: "Health" },
] as const

function isActive(pathname: string, href: string): boolean {
  if (href === "/") return pathname === "/"
  return pathname === href || pathname.startsWith(`${href}/`)
}

// Pre-auth pages: the middleware sends signed-out and non-admin visitors here,
// so a nav full of links they cannot open would be noise.
const CHROMELESS = ["/login", "/not-authorized"]

export function Nav() {
  const pathname = usePathname()
  if (CHROMELESS.includes(pathname)) return null

  return (
    <header className="border-b">
      <nav className="mx-auto flex max-w-6xl flex-wrap items-center gap-1 px-8 py-3">
        <span className="mr-4 text-sm font-semibold tracking-tight">SermonSeek Admin</span>
        {LINKS.map((link) => (
          <Link
            key={link.href}
            href={link.href}
            aria-current={isActive(pathname, link.href) ? "page" : undefined}
            className={cn(
              "rounded-md px-3 py-1.5 text-sm transition-colors",
              isActive(pathname, link.href)
                ? "bg-secondary font-medium text-secondary-foreground"
                : "text-muted-foreground hover:bg-accent hover:text-accent-foreground",
            )}
          >
            {link.label}
          </Link>
        ))}
      </nav>
    </header>
  )
}
