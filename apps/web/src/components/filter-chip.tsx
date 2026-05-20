"use client"

import { Check, ChevronDown, type LucideIcon, X } from "lucide-react"
import { useEffect, useMemo, useRef, useState } from "react"

export interface FilterChipOption {
  value: string
  label: string
}

interface FilterChipProps {
  label: string
  value: string
  options: FilterChipOption[]
  onChange: (value: string) => void
  // Shown when value === "" (e.g. "All playlists")
  emptyLabel: string
  // When true, render a text input at the top of the dropdown that filters
  // options as the user types.
  searchable?: boolean
  searchPlaceholder?: string
  // "pill" (default): full chip with label and value. "icon": small icon-only
  // button trigger with an active-state dot indicator — for embedding inside
  // tight UI like the search input field.
  variant?: "pill" | "icon"
  // Required when variant === "icon".
  icon?: LucideIcon
}

export function FilterChip({
  label,
  value,
  options,
  onChange,
  emptyLabel,
  searchable = false,
  searchPlaceholder,
  variant = "pill",
  icon: Icon,
}: FilterChipProps) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState("")
  const containerRef = useRef<HTMLDivElement>(null)
  const searchInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!open) return
    function onDocClick(e: MouseEvent) {
      if (!containerRef.current?.contains(e.target as Node)) setOpen(false)
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false)
    }
    document.addEventListener("mousedown", onDocClick)
    document.addEventListener("keydown", onKey)
    return () => {
      document.removeEventListener("mousedown", onDocClick)
      document.removeEventListener("keydown", onKey)
    }
  }, [open])

  useEffect(() => {
    if (open && searchable) {
      searchInputRef.current?.focus()
    } else if (!open) {
      setQuery("")
    }
  }, [open, searchable])

  const active = value !== ""
  const selected = options.find((o) => o.value === value)
  const display = selected ? selected.label : emptyLabel

  const filtered = useMemo(() => {
    if (!searchable || !query.trim()) return options
    const needle = query.trim().toLowerCase()
    return options.filter((o) => o.label.toLowerCase().includes(needle))
  }, [options, query, searchable])

  return (
    <div ref={containerRef} className="relative inline-block">
      {variant === "icon" && Icon ? (
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className={`relative inline-flex h-9 w-9 items-center justify-center rounded-md transition-colors ${
            active
              ? "text-primary hover:bg-accent"
              : "text-muted-foreground hover:bg-accent hover:text-foreground"
          }`}
          aria-expanded={open}
          aria-haspopup="listbox"
          aria-label={label}
          title={active ? `${label}: ${display}` : label}
        >
          <Icon className="h-4 w-4" aria-hidden />
          {active && (
            <span className="absolute top-1.5 right-1.5 h-1.5 w-1.5 rounded-full bg-primary" />
          )}
        </button>
      ) : (
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-sm transition-colors ${
            active
              ? "border-primary bg-primary/10 text-foreground"
              : "border-input bg-background text-muted-foreground hover:bg-accent"
          }`}
          aria-expanded={open}
          aria-haspopup="listbox"
        >
          <span className="font-medium text-foreground">{label}</span>
          {active && (
            <>
              <span className="text-foreground/70">:</span>
              <span className="text-foreground">{display}</span>
            </>
          )}
          {active ? (
            <span
              role="button"
              tabIndex={0}
              aria-label={`Clear ${label} filter`}
              className="ml-0.5 inline-flex h-4 w-4 items-center justify-center rounded-full hover:bg-foreground/10"
              onClick={(e) => {
                e.stopPropagation()
                onChange("")
                setOpen(false)
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault()
                  e.stopPropagation()
                  onChange("")
                  setOpen(false)
                }
              }}
            >
              <X className="h-3 w-3" />
            </span>
          ) : (
            <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
          )}
        </button>
      )}

      {open && (
        <div
          role="listbox"
          className="absolute left-0 top-full z-20 mt-1 min-w-[14rem] max-h-80 overflow-hidden rounded-md border bg-popover shadow-md flex flex-col"
        >
          {searchable && (
            <div className="border-b p-1">
              <input
                ref={searchInputRef}
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={searchPlaceholder ?? `Search ${label.toLowerCase()}`}
                className="w-full rounded bg-transparent px-2 py-1 text-sm outline-none placeholder:text-muted-foreground"
              />
            </div>
          )}
          <div className="overflow-auto p-1">
            <button
              type="button"
              role="option"
              aria-selected={!active}
              onClick={() => {
                onChange("")
                setOpen(false)
              }}
              className="flex w-full items-center justify-between gap-2 rounded px-2 py-1.5 text-sm text-left hover:bg-accent"
            >
              <span className="text-muted-foreground">{emptyLabel}</span>
              {!active && <Check className="h-3.5 w-3.5" />}
            </button>
            {filtered.map((opt) => {
              const isSelected = opt.value === value
              return (
                <button
                  key={opt.value}
                  type="button"
                  role="option"
                  aria-selected={isSelected}
                  onClick={() => {
                    onChange(opt.value)
                    setOpen(false)
                  }}
                  className="flex w-full items-center justify-between gap-2 rounded px-2 py-1.5 text-sm text-left hover:bg-accent"
                >
                  <span>{opt.label}</span>
                  {isSelected && <Check className="h-3.5 w-3.5" />}
                </button>
              )
            })}
            {searchable && filtered.length === 0 && (
              <div className="px-2 py-1.5 text-sm text-muted-foreground">No matches</div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
