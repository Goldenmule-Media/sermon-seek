import type { ScriptureRefDetail } from "@sermon-search/types"
import Link from "next/link"

interface ScriptureRefBoxProps {
  refs: ScriptureRefDetail[]
  label: string
  limit?: number
}

export function ScriptureRefBox({ refs, label, limit }: ScriptureRefBoxProps) {
  if (refs.length === 0) return null
  const shown = limit ? refs.slice(0, limit) : refs
  const overflow = refs.length - shown.length

  return (
    <div className="rounded-lg border bg-card p-3">
      <p className="text-xs font-medium text-muted-foreground mb-2">{label}</p>
      <div className="flex flex-wrap gap-1.5">
        {shown.map((r) => (
          <Link
            key={`${r.start_coord}-${r.end_coord}`}
            href={`/search?ref=${encodeURIComponent(r.display)}`}
            className="inline-flex items-center gap-1 rounded-md border bg-background px-2 py-0.5 text-xs hover:bg-accent transition-colors"
          >
            <span>{r.display}</span>
            <span className="text-muted-foreground">{r.occurrences}</span>
          </Link>
        ))}
        {overflow > 0 && (
          <span className="inline-flex items-center rounded-md px-2 py-0.5 text-xs text-muted-foreground">
            +{overflow} more
          </span>
        )}
      </div>
    </div>
  )
}
