import { BookOpen, Clock, ListVideo, Search } from "lucide-react"
import type { Metadata } from "next"

export const metadata: Metadata = {
  title: "SermonSeek.ai — sermon search for churches",
  description:
    "Sermon-Search indexes your church's YouTube sermons and makes them searchable by keyword, scripture, topic, or meaning.",
}

const features = [
  {
    icon: Search,
    title: "Full-text, semantic & hybrid search",
    description:
      "Find sermons by exact phrase, scripture reference, topic, or the meaning behind a question — even when the words don't match exactly.",
  },
  {
    icon: BookOpen,
    title: "Scripture & topic auto-tagging",
    description:
      "Every sermon is automatically tagged with the scripture passages and themes it covers, so browsing by topic or verse just works.",
  },
  {
    icon: Clock,
    title: "Deep links to the exact moment",
    description:
      "Search results link directly to the timestamp where a phrase was spoken — no scrubbing required.",
  },
  {
    icon: ListVideo,
    title: "Playlists & related videos",
    description:
      "Series, playlists, and related sermons surface naturally alongside search results so visitors can go deeper.",
  },
]

const screenshots = [
  { caption: "Home feed" },
  { caption: "Search results" },
  { caption: "Video + transcript" },
  { caption: "Topics & playlists" },
]

export default function RootPage() {
  return (
    <main>
      {/* Hero */}
      <section className="mx-auto max-w-3xl px-4 py-24 text-center sm:px-6 lg:px-8">
        <div className="mb-6 flex justify-center">
          <span className="flex items-center gap-3 text-4xl font-bold tracking-tight">
            <Search className="h-10 w-10 text-primary" aria-hidden />
            SermonSeek.ai
          </span>
        </div>
        <p className="text-xl text-muted-foreground">Sermon search for churches.</p>
        <p className="mt-6 text-base text-muted-foreground leading-relaxed">
          Sermon-Search is a search service for sermons, built for churches. A church&apos;s YouTube
          channels are ingested, transcribed, enriched, and indexed so that congregants and visitors
          can search the full corpus by keyword, semantic meaning, scripture reference, topic, or
          playlist — and land directly at the moment in the video where a phrase was spoken.
        </p>
      </section>

      {/* Features */}
      <section className="border-t bg-muted/30">
        <div className="mx-auto max-w-7xl px-4 py-16 sm:px-6 lg:px-8">
          <h2 className="text-center text-2xl font-semibold tracking-tight">What it does</h2>
          <div className="mt-10 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
            {features.map(({ icon: Icon, title, description }) => (
              <div key={title} className="rounded-lg border bg-card p-6 flex flex-col gap-3">
                <Icon className="h-6 w-6 text-primary" aria-hidden />
                <h3 className="font-semibold leading-snug">{title}</h3>
                <p className="text-sm text-muted-foreground leading-relaxed">{description}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Screenshots row (skeleton placeholders — real assets to follow) */}
      <section className="mx-auto max-w-7xl px-4 py-16 sm:px-6 lg:px-8">
        <h2 className="text-center text-2xl font-semibold tracking-tight">See it in action</h2>
        <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {screenshots.map(({ caption }) => (
            <div key={caption} className="flex flex-col gap-2">
              <div className="aspect-video w-full rounded-lg bg-muted animate-pulse" />
              <p className="text-center text-sm text-muted-foreground">{caption}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Contact */}
      <section className="border-t bg-muted/30">
        <div className="mx-auto max-w-3xl px-4 py-16 text-center sm:px-6 lg:px-8">
          <h2 className="text-2xl font-semibold tracking-tight">
            Interested in adding your church?
          </h2>
          <p className="mt-4 text-muted-foreground">
            Onboarding is currently developer-provisioned — there&apos;s no self-signup form. Reach
            out and we&apos;ll get your channels indexed.
          </p>
          <a
            href="mailto:benjamin@thegoldenmule.com?subject=SermonSeek.ai%20church%20onboarding"
            className="mt-6 inline-block rounded-lg bg-primary px-6 py-3 text-sm font-medium text-primary-foreground hover:opacity-90 transition-opacity"
          >
            Get in touch
          </a>
        </div>
      </section>
    </main>
  )
}
