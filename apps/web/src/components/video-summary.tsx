interface VideoSummaryProps {
  summary: string
}

export function VideoSummary({ summary }: VideoSummaryProps) {
  if (!summary) return null

  return <p className="text-sm italic text-foreground/80">{summary}</p>
}
