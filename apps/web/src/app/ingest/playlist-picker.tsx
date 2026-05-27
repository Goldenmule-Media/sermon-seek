"use client"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { X } from "lucide-react"
import { useRef, useState } from "react"

interface ChipListProps {
  label: string
  ids: string[]
  onAdd: (id: string) => void
  onRemove: (id: string) => void
  inputId: string
}

function ChipList({ label, ids, onAdd, onRemove, inputId }: ChipListProps) {
  const [draft, setDraft] = useState("")
  const inputRef = useRef<HTMLInputElement>(null)

  function commit() {
    const trimmed = draft.trim()
    if (trimmed && !ids.includes(trimmed)) {
      onAdd(trimmed)
    }
    setDraft("")
    inputRef.current?.focus()
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") {
      e.preventDefault()
      commit()
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <label htmlFor={inputId} className="text-sm font-medium">
        {label}
      </label>
      <div className="flex gap-2">
        <Input
          id={inputId}
          ref={inputRef}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Paste a playlist ID (e.g. PLxyz…)"
          className="flex-1"
        />
        <Button type="button" variant="outline" size="sm" onClick={commit} disabled={!draft.trim()}>
          Add
        </Button>
      </div>
      {ids.length > 0 && (
        <ul className="flex flex-wrap gap-2" aria-label={`${label} list`}>
          {ids.map((id) => (
            <li
              key={id}
              className="flex items-center gap-1 rounded-full border bg-muted px-3 py-1 text-xs"
            >
              <span className="font-mono">{id}</span>
              <button
                type="button"
                onClick={() => onRemove(id)}
                aria-label={`Remove ${id}`}
                className="ml-1 text-muted-foreground hover:text-foreground"
              >
                <X className="h-3 w-3" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

interface PlaylistPickerProps {
  includeIds: string[]
  excludeIds: string[]
  onIncludeChange: (ids: string[]) => void
  onExcludeChange: (ids: string[]) => void
}

export function PlaylistPicker({
  includeIds,
  excludeIds,
  onIncludeChange,
  onExcludeChange,
}: PlaylistPickerProps) {
  return (
    <fieldset className="flex flex-col gap-4 rounded-md border px-4 py-4">
      <legend className="px-1 text-sm font-semibold">Playlist filters (optional)</legend>
      <p className="text-xs text-muted-foreground">
        Leave both lists empty to ingest all playlists. Add playlist IDs to include only specific
        playlists, or to exclude specific playlists from an otherwise full ingest.
      </p>
      <ChipList
        label="Include only"
        ids={includeIds}
        onAdd={(id) => onIncludeChange([...includeIds, id])}
        onRemove={(id) => onIncludeChange(includeIds.filter((x) => x !== id))}
        inputId="include-playlist-ids"
      />
      <ChipList
        label="Exclude"
        ids={excludeIds}
        onAdd={(id) => onExcludeChange([...excludeIds, id])}
        onRemove={(id) => onExcludeChange(excludeIds.filter((x) => x !== id))}
        inputId="exclude-playlist-ids"
      />
    </fieldset>
  )
}
