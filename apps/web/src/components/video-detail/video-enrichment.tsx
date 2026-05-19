import Link from "next/link"

interface VideoEnrichmentProps {
  summary: string
  topics: Array<{ slug: string; label: string }>
  scriptureRefs: string[]
}

export function VideoEnrichment({ summary, topics, scriptureRefs }: VideoEnrichmentProps) {
  if (!summary && topics.length === 0 && scriptureRefs.length === 0) return null

  return (
    <div className="space-y-3 mb-4">
      {summary && <p className="text-sm text-muted-foreground leading-relaxed">{summary}</p>}
      {topics.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {topics.map((t) => (
            <Link
              key={t.slug}
              href={`/topics/${t.slug}`}
              className="inline-block px-2 py-0.5 text-xs rounded-full bg-primary/10 text-primary hover:bg-primary/20 transition-colors"
            >
              {t.label}
            </Link>
          ))}
        </div>
      )}
      {scriptureRefs.length > 0 && (
        <p className="text-xs text-muted-foreground">
          <span className="font-medium">Scripture: </span>
          {scriptureRefs.join(" · ")}
        </p>
      )}
    </div>
  )
}
