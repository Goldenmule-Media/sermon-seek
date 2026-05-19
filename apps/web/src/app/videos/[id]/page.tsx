import Link from "next/link"

// TODO(C15): replace with the full video detail page
export default async function VideoDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params

  return (
    <main className="max-w-4xl mx-auto px-4 py-8 space-y-4">
      <p className="text-sm text-muted-foreground">Video ID: {id}</p>
      <Link href="/" className="text-primary hover:underline text-sm">
        ← back to home
      </Link>
    </main>
  )
}
