import type { PlaylistFilters } from "@/lib/api"

interface Props {
  filters: PlaylistFilters
}

export function PlaylistFiltersPanel({ filters }: Props) {
  const { mode, playlist_ids } = filters

  let heading: string
  if (mode === "include") heading = "Only these playlists"
  else if (mode === "exclude") heading = "All except these playlists"
  else heading = "Ingest all playlists"

  return (
    <section className="rounded-lg border p-4 space-y-3">
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        Playlist filters
      </p>
      <p className="text-sm font-medium">{heading}</p>
      {mode !== "none" && playlist_ids.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {playlist_ids.map((id) => (
            <span
              key={id}
              className="inline-flex items-center rounded-md bg-muted px-2 py-1 text-xs font-mono text-muted-foreground"
            >
              {id}
            </span>
          ))}
        </div>
      )}
    </section>
  )
}
