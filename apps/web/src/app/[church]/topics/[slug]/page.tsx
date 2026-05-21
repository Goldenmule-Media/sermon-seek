import { VideoCard } from "@/components/video-card"
import { fetchTopic } from "@/lib/api"
import Link from "next/link"
import { notFound } from "next/navigation"

const PAGE_SIZE = 20

interface TopicPageProps {
  params: Promise<{ church: string; slug: string }>
  searchParams: Promise<{ offset?: string }>
}

export default async function TopicPage({ params, searchParams }: TopicPageProps) {
  const { church, slug } = await params
  const { offset: rawOffset } = await searchParams
  const offset = Math.max(0, Number(rawOffset ?? 0))

  const data = await fetchTopic(church, slug, { limit: PAGE_SIZE, offset })
  if (!data) notFound()

  const { topic, videos, total } = data
  const hasPrev = offset > 0
  const hasNext = offset + PAGE_SIZE < total
  const prevOffset = Math.max(0, offset - PAGE_SIZE)
  const nextOffset = offset + PAGE_SIZE

  return (
    <main className="max-w-6xl mx-auto px-4 py-8">
      <Link
        href={`/${church}/topics`}
        className="text-sm text-primary hover:underline mb-4 inline-block"
      >
        ← all topics
      </Link>
      <div className="mb-6">
        <h1 className="text-2xl font-bold capitalize">{topic.label}</h1>
        <p className="text-sm text-muted-foreground mt-1">
          {total} video{total !== 1 ? "s" : ""}
        </p>
      </div>
      {videos.length === 0 ? (
        <p className="text-muted-foreground">No videos found.</p>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
          {videos.map((video) => (
            <VideoCard key={video.id} video={video} church={church} />
          ))}
        </div>
      )}
      {(hasPrev || hasNext) && (
        <div className="flex gap-4 mt-8">
          {hasPrev && (
            <Link
              href={`/${church}/topics/${slug}?offset=${prevOffset}`}
              className="text-sm text-primary hover:underline"
            >
              ← previous
            </Link>
          )}
          {hasNext && (
            <Link
              href={`/${church}/topics/${slug}?offset=${nextOffset}`}
              className="text-sm text-primary hover:underline ml-auto"
            >
              next →
            </Link>
          )}
        </div>
      )}
    </main>
  )
}
