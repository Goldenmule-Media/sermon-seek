import { SearchBox } from "@/components/search-box"
import { VideoStrip } from "@/components/video-strip"
import { fetchHome } from "@/lib/api"

export default async function HomePage() {
  const data = await fetchHome()

  return (
    <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-10">
      <section className="flex flex-col items-center py-12 gap-4">
        <h1 className="text-3xl font-bold tracking-tight">Sermon Search</h1>
        <p className="text-muted-foreground">
          Search thousands of sermons by topic, scripture, or keyword.
        </p>
        <div className="w-full max-w-2xl">
          <SearchBox />
        </div>
      </section>

      <VideoStrip title="Recent Uploads" videos={data.recent} />

      {data.top_playlists.map(({ playlist, videos }) => (
        <VideoStrip
          key={playlist.id}
          title={playlist.title}
          seeAllHref={`/category/${playlist.slug}`}
          videos={videos}
        />
      ))}
    </main>
  )
}
