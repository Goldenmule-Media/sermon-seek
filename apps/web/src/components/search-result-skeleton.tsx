// Shape-matched skeleton for SearchResultCard. Renders during loading so the
// page doesn't snap from empty → fully populated.

interface SearchResultSkeletonProps {
  hitCount?: number
}

export function SearchResultSkeleton({ hitCount = 3 }: SearchResultSkeletonProps) {
  return (
    <div className="flex gap-4 p-4 rounded-lg border bg-card animate-pulse">
      <div className="shrink-0 w-40 h-24 rounded bg-muted" />
      <div className="flex flex-col gap-2 min-w-0 flex-1">
        <div className="h-4 w-3/4 rounded bg-muted" />
        <div className="space-y-1.5">
          <div className="h-3 w-full rounded bg-muted/70" />
          <div className="h-3 w-5/6 rounded bg-muted/70" />
        </div>
        <ul className="flex flex-col gap-1.5 mt-1">
          {Array.from({ length: hitCount }).map((_, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: static placeholder list
            <li key={i} className="flex items-baseline gap-3">
              <div className="h-3 w-10 rounded bg-muted shrink-0" />
              <div className="h-3 flex-1 rounded bg-muted/70" />
            </li>
          ))}
        </ul>
        <div className="rounded-md border bg-muted/40 p-2 mt-1 space-y-1.5">
          <div className="h-2 w-24 rounded bg-muted/70" />
          <div className="flex flex-wrap gap-1">
            {Array.from({ length: 5 }).map((_, i) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: static placeholder list
              <div key={i} className="h-4 w-16 rounded bg-muted" />
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

export function SearchResultsSkeleton({ count = 4 }: { count?: number }) {
  return (
    <ul className="space-y-3">
      {Array.from({ length: count }).map((_, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: static placeholder list
        <li key={i}>
          <SearchResultSkeleton />
        </li>
      ))}
    </ul>
  )
}
