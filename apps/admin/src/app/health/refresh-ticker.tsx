"use client"

import { useRouter } from "next/navigation"
import { useEffect } from "react"

export function RefreshTicker() {
  const router = useRouter()

  useEffect(() => {
    const id = setInterval(() => router.refresh(), 30_000)
    return () => clearInterval(id)
  }, [router])

  return <span className="text-xs text-muted-foreground">Auto-refresh: 30s</span>
}
