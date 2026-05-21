import { SearchBox } from "@/components/search-box"
import { VideoStrip } from "@/components/video-strip"
import { fetchHome } from "@/lib/api"
import { Search } from "lucide-react"
import { notFound } from "next/navigation"

export default async function ChurchHomePage({
  params,
}: {
  params: Promise<{ church: string }>
}) {
  const { church } = await params
  const data = await fetchHome(church)

  if (!data) notFound()

  return (
    <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-10">
      <section className="flex flex-col items-center py-12 gap-4">
        <h1 className="flex items-center gap-3 text-3xl font-bold tracking-tight">
          <Search className="h-8 w-8 text-primary" aria-hidden />
          <span>Sermon Seek</span>
        </h1>
        <p className="text-muted-foreground">
          Search thousands of sermons by topic, scripture, or keyword.
        </p>
        <div className="w-full max-w-2xl">
          <SearchBox church={church} />
        </div>
      </section>

      <VideoStrip church={church} title="Recent Uploads" videos={data.recent} />

      {data.category_strips.map(({ playlist, videos }) => (
        <VideoStrip
          key={playlist.id}
          church={church}
          title={playlist.title}
          seeAllHref={`/${church}/category/${playlist.slug}`}
          videos={videos}
        />
      ))}
    </main>
  )
}
