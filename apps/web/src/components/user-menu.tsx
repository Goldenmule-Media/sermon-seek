"use client"

import { googleStartUrl, postLogout } from "@/lib/auth"
import { useUser } from "@/lib/use-user"
import { usePathname, useSearchParams } from "next/navigation"
import { useEffect, useRef, useState } from "react"
import { Button } from "./ui/button"

function buildReturnTo(pathname: string, searchParams: URLSearchParams): string {
  const qs = searchParams.toString()
  return qs ? `${pathname}?${qs}` : pathname
}

function AvatarFallback({ name }: { name: string | null }) {
  const letter = name ? name.charAt(0).toUpperCase() : "?"
  return (
    <span
      className="flex h-8 w-8 items-center justify-center rounded-full bg-primary text-xs font-semibold text-primary-foreground select-none"
      aria-hidden
    >
      {letter}
    </span>
  )
}

export function UserMenu() {
  const { user, status, refresh } = useUser()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const [open, setOpen] = useState(false)
  const [avatarError, setAvatarError] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false)
    }
    function onClickOutside(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener("keydown", onKeyDown)
    document.addEventListener("mousedown", onClickOutside)
    return () => {
      document.removeEventListener("keydown", onKeyDown)
      document.removeEventListener("mousedown", onClickOutside)
    }
  }, [open])

  if (status === "loading") {
    return <div className="h-8 w-16" aria-hidden />
  }

  if (!user) {
    const returnTo = buildReturnTo(pathname, searchParams)
    return (
      <Button asChild size="sm" variant="outline">
        <a href={googleStartUrl(returnTo)}>Sign in</a>
      </Button>
    )
  }

  async function handleSignOut() {
    setOpen(false)
    await postLogout()
    await refresh()
  }

  return (
    <div className="relative" ref={menuRef}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        aria-label="Account menu"
        aria-expanded={open}
        aria-haspopup="true"
      >
        {user.avatar_url && !avatarError ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={user.avatar_url}
            alt={user.display_name ?? "Avatar"}
            className="h-8 w-8 rounded-full object-cover"
            referrerPolicy="no-referrer"
            onError={() => setAvatarError(true)}
          />
        ) : (
          <AvatarFallback name={user.display_name} />
        )}
      </button>

      {open && (
        <div
          className="absolute right-0 mt-2 w-44 rounded-md border bg-popover text-popover-foreground shadow-md z-50"
        >
          <div className="flex flex-col py-1">
            <span
              aria-disabled="true"
              tabIndex={-1}
              className="px-3 py-2 text-sm text-muted-foreground cursor-default select-none"
            >
              My requests
            </span>
            <button
              type="button"
              onClick={handleSignOut}
              className="px-3 py-2 text-sm text-left hover:bg-accent hover:text-accent-foreground transition-colors"
            >
              Sign out
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
