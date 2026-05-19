import Link from "next/link"

export default function VideoNotFound() {
  return (
    <main className="max-w-4xl mx-auto px-4 py-8 space-y-4">
      <h1 className="text-xl font-semibold">Video not found</h1>
      <p className="text-sm text-muted-foreground">
        The video you&apos;re looking for doesn&apos;t exist or has been removed.
      </p>
      <Link href="/" className="text-primary hover:underline text-sm">
        ← back to home
      </Link>
    </main>
  )
}
