"use client"

import { Calendar, Check, ChevronDown, X } from "lucide-react"
import { useEffect, useRef, useState } from "react"

interface DateFilterChipProps {
  // Inclusive ISO dates (YYYY-MM-DD), or "" when unset.
  from: string
  to: string
  onChange: (from: string, to: string) => void
  // "pill" (default): full chip with label and value. "icon": small icon-only
  // trigger with an active-state dot indicator.
  variant?: "pill" | "icon"
}

interface Preset {
  key: string
  label: string
  // Returns { from, to } as YYYY-MM-DD. `to` is today.
  range: () => { from: string; to: string }
}

function isoDate(d: Date): string {
  const y = d.getUTCFullYear()
  const m = String(d.getUTCMonth() + 1).padStart(2, "0")
  const day = String(d.getUTCDate()).padStart(2, "0")
  return `${y}-${m}-${day}`
}

function daysAgo(n: number): string {
  const d = new Date()
  d.setUTCDate(d.getUTCDate() - n)
  return isoDate(d)
}

function startOfYear(): string {
  const d = new Date()
  return `${d.getUTCFullYear()}-01-01`
}

const PRESETS: Preset[] = [
  { key: "week", label: "Past week", range: () => ({ from: daysAgo(7), to: isoDate(new Date()) }) },
  {
    key: "month",
    label: "Past 30 days",
    range: () => ({ from: daysAgo(30), to: isoDate(new Date()) }),
  },
  {
    key: "ytd",
    label: "Year to date",
    range: () => ({ from: startOfYear(), to: isoDate(new Date()) }),
  },
  {
    key: "year",
    label: "Past year",
    range: () => ({ from: daysAgo(365), to: isoDate(new Date()) }),
  },
]

function matchPreset(from: string, to: string): Preset | null {
  for (const p of PRESETS) {
    const r = p.range()
    if (r.from === from && r.to === to) return p
  }
  return null
}

function describeRange(from: string, to: string): string {
  if (from && to) return `${from} → ${to}`
  if (from) return `from ${from}`
  if (to) return `until ${to}`
  return ""
}

export function DateFilterChip({ from, to, onChange, variant = "pill" }: DateFilterChipProps) {
  const [open, setOpen] = useState(false)
  const [customFrom, setCustomFrom] = useState(from)
  const [customTo, setCustomTo] = useState(to)
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    setCustomFrom(from)
    setCustomTo(to)
  }, [from, to])

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

  const active = Boolean(from || to)
  const preset = active ? matchPreset(from, to) : null
  const display = preset ? preset.label : active ? describeRange(from, to) : "Any time"

  function applyPreset(p: Preset) {
    const r = p.range()
    onChange(r.from, r.to)
    setOpen(false)
  }

  function applyCustom() {
    onChange(customFrom, customTo)
    setOpen(false)
  }

  return (
    <div ref={containerRef} className="relative inline-block">
      {variant === "icon" ? (
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
          aria-label="Filter by date"
          title={active ? `Date: ${display}` : "Filter by date"}
        >
          <Calendar className="h-4 w-4" aria-hidden />
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
          <span className="font-medium text-foreground">Date</span>
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
              aria-label="Clear date filter"
              className="ml-0.5 inline-flex h-4 w-4 items-center justify-center rounded-full hover:bg-foreground/10"
              onClick={(e) => {
                e.stopPropagation()
                onChange("", "")
                setOpen(false)
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault()
                  e.stopPropagation()
                  onChange("", "")
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
          className="absolute left-0 top-full z-20 mt-1 min-w-[16rem] rounded-md border bg-popover p-1 shadow-md"
        >
          <button
            type="button"
            role="option"
            aria-selected={!active}
            onClick={() => {
              onChange("", "")
              setOpen(false)
            }}
            className="flex w-full items-center justify-between gap-2 rounded px-2 py-1.5 text-sm text-left hover:bg-accent"
          >
            <span className="text-muted-foreground">Any time</span>
            {!active && <Check className="h-3.5 w-3.5" />}
          </button>
          {PRESETS.map((p) => {
            const isSelected = preset?.key === p.key
            return (
              <button
                key={p.key}
                type="button"
                role="option"
                aria-selected={isSelected}
                onClick={() => applyPreset(p)}
                className="flex w-full items-center justify-between gap-2 rounded px-2 py-1.5 text-sm text-left hover:bg-accent"
              >
                <span>{p.label}</span>
                {isSelected && <Check className="h-3.5 w-3.5" />}
              </button>
            )
          })}
          <div className="my-1 border-t" />
          <div className="px-2 py-1.5 space-y-2">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Custom range
            </p>
            <div className="flex items-center gap-2">
              <label className="flex flex-col gap-0.5 text-xs text-muted-foreground">
                From
                <input
                  type="date"
                  value={customFrom}
                  max={customTo || undefined}
                  onChange={(e) => setCustomFrom(e.target.value)}
                  className="rounded border bg-background px-2 py-1 text-sm text-foreground"
                />
              </label>
              <label className="flex flex-col gap-0.5 text-xs text-muted-foreground">
                To
                <input
                  type="date"
                  value={customTo}
                  min={customFrom || undefined}
                  onChange={(e) => setCustomTo(e.target.value)}
                  className="rounded border bg-background px-2 py-1 text-sm text-foreground"
                />
              </label>
            </div>
            <button
              type="button"
              onClick={applyCustom}
              disabled={!customFrom && !customTo}
              className="w-full rounded bg-primary px-2 py-1 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Apply
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
