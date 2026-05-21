import { fetchTopics } from "@/lib/api"
import Link from "next/link"

export default async function TopicsPage({
  params,
}: {
  params: Promise<{ church: string }>
}) {
  const { church } = await params
  const topics = await fetchTopics(church)

  return (
    <main className="max-w-3xl mx-auto px-4 py-8">
      <Link href={`/${church}`} className="text-sm text-primary hover:underline mb-4 inline-block">
        ← back to home
      </Link>
      <h1 className="text-2xl font-bold mb-6">Topics</h1>
      {topics.length === 0 ? (
        <p className="text-muted-foreground">No topics found.</p>
      ) : (
        <div className="flex flex-wrap gap-3">
          {topics.map((topic) => (
            <Link
              key={topic.slug}
              href={`/${church}/topics/${topic.slug}`}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-primary/10 text-primary hover:bg-primary/20 transition-colors text-sm font-medium"
            >
              {topic.label}
              <span className="text-xs text-muted-foreground">({topic.video_count})</span>
            </Link>
          ))}
        </div>
      )}
    </main>
  )
}
