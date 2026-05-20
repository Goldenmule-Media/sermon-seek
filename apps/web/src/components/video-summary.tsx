interface VideoSummaryProps {
  summary: string
}

export function VideoSummary({ summary }: VideoSummaryProps) {
  if (!summary) return null

  return (
    <div className="rounded-md border-l-2 border-primary/40 bg-muted/30 px-3 py-2">
      <p className="text-sm italic text-foreground/80">{summary}</p>
    </div>
  )
}
