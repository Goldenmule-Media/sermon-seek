"use client"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { X } from "lucide-react"
import { useRef, useState } from "react"

const ERROR_MESSAGES: Record<string, string> = {
  invalid_format: "Doesn't look like a playlist ID.",
  not_found_on_youtube: "Not found on YouTube.",
  wrong_channel: "Doesn't belong to this channel.",
  youtube_error: "YouTube couldn't verify this playlist. Try again.",
}

interface PlaylistPickerProps {
  mode: "include" | "exclude"
  ids: string[]
  onChange: (ids: string[]) => void
  errors: Record<string, string>
  onClearError: (id: string) => void
  emptyError?: string | null
}

export function PlaylistPicker({
  mode,
  ids,
  onChange,
  errors,
  onClearError,
  emptyError,
}: PlaylistPickerProps) {
  const [draft, setDraft] = useState("")
  const inputRef = useRef<HTMLInputElement>(null)

  const legend =
    mode === "include" ? "Only ingest these playlists" : "Ingest all except these playlists"
  const helpText =
    mode === "include"
      ? "Only these playlists will be ingested. Add at least one."
      : "All playlists will be ingested except these."

  function commit() {
    const trimmed = draft.trim()
    if (trimmed && !ids.includes(trimmed)) {
      onChange([...ids, trimmed])
      onClearError(trimmed)
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

  function remove(id: string) {
    onChange(ids.filter((x) => x !== id))
    onClearError(id)
  }

  const inputId = `playlist-ids-${mode}`

  return (
    <fieldset className="flex flex-col gap-2 rounded-md border px-4 py-4">
      <legend className="px-1 text-sm font-semibold">{legend}</legend>
      <p className="text-xs text-muted-foreground">{helpText}</p>
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
      {emptyError && (
        <p role="alert" className="text-xs text-destructive">
          {emptyError}
        </p>
      )}
      {ids.length > 0 && (
        <ul className="flex flex-col gap-1" aria-label={`${legend} list`}>
          {ids.map((id) => {
            const errorCode = errors[id]
            const errorMsg = errorCode ? (ERROR_MESSAGES[errorCode] ?? errorCode) : undefined
            const chipId = `chip-error-${id}`
            return (
              <li key={id} className="flex flex-col gap-0.5">
                <div
                  className={`flex items-center gap-1 rounded-full border px-3 py-1 text-xs w-fit ${errorCode ? "border-destructive bg-destructive/10" : "bg-muted"}`}
                >
                  <span className="font-mono" aria-describedby={errorMsg ? chipId : undefined}>
                    {id}
                  </span>
                  <button
                    type="button"
                    onClick={() => remove(id)}
                    aria-label={`Remove ${id}`}
                    className="ml-1 text-muted-foreground hover:text-foreground"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </div>
                {errorMsg && (
                  <span id={chipId} role="alert" className="text-xs text-destructive pl-3">
                    {errorMsg}
                  </span>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </fieldset>
  )
}
