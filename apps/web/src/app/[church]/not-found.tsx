import Link from "next/link"

export default function ChurchNotFound() {
  return (
    <main className="max-w-4xl mx-auto px-4 py-8 space-y-4">
      <h1 className="text-xl font-semibold">Page not found</h1>
      <p className="text-sm text-muted-foreground">
        The page you&apos;re looking for doesn&apos;t exist or the church slug is not recognised.
      </p>
      <Link href="/" className="text-primary hover:underline text-sm">
        ← back to home
      </Link>
    </main>
  )
}
