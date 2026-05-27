"use client"

import { Button } from "@/components/ui/button"
import { googleStartUrl } from "@/lib/auth"

export function IngestSignInGate() {
  return (
    <main className="mx-auto max-w-md px-4 py-24 text-center sm:px-6">
      <h1 className="text-2xl font-semibold tracking-tight">Request a church</h1>
      <p className="mt-4 text-muted-foreground">
        Sign in with Google to submit a self-service ingestion request for your church&apos;s
        YouTube channel.
      </p>
      <div className="mt-8">
        <Button asChild>
          <a href={googleStartUrl("/ingest")}>Sign in with Google</a>
        </Button>
      </div>
    </main>
  )
}
