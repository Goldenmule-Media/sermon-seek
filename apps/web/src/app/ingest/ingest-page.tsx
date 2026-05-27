"use client"

import { useUser } from "@/lib/use-user"
import { IngestForm } from "./ingest-form"
import { IngestSignInGate } from "./ingest-sign-in-gate"

export function IngestPage() {
  const { user, status } = useUser()

  if (status === "loading") {
    return <div className="min-h-screen" aria-hidden />
  }

  if (!user) {
    return <IngestSignInGate />
  }

  return <IngestForm user={user} />
}
