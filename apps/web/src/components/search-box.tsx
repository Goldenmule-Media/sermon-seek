"use client"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { useRouter } from "next/navigation"
import { useState } from "react"

export function SearchBox() {
  const router = useRouter()
  const [query, setQuery] = useState("")

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const q = query.trim()
    if (q) router.push(`/search?q=${encodeURIComponent(q)}`)
  }

  return (
    <div className="w-full max-w-2xl space-y-2">
      <form onSubmit={handleSubmit} className="flex gap-2">
        <Input
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search sermons..."
          className="flex-1 h-12 text-base"
        />
        <Button type="submit" className="h-12 px-6">
          Search
        </Button>
      </form>
      <p className="text-sm text-muted-foreground text-center">try: grace, Romans 8, forgiveness</p>
    </div>
  )
}
