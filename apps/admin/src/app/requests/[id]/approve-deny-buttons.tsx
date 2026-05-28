"use client"

import { Button } from "@/components/ui/button"
import type { IngestionRequestStatus, PlaylistFilters } from "@/lib/api"
import { useRef, useState, useTransition } from "react"
import { approveAction, denyAction } from "./actions"

interface Props {
  requestId: string
  status: IngestionRequestStatus
  playlistFilters: PlaylistFilters
}

function filterSummary(filters: PlaylistFilters): string {
  const { mode, playlist_ids } = filters
  if (mode === "none") return "Ingest all playlists — no filter rules will be created."
  const label = mode === "include" ? "Only these playlists" : "All except these playlists"
  return `${label}: ${playlist_ids.join(", ")}`
}

export function ApproveDenyButtons({ requestId, status, playlistFilters }: Props) {
  const [isPending, startTransition] = useTransition()
  const [approveOpen, setApproveOpen] = useState(false)
  const [approveError, setApproveError] = useState<string | null>(null)
  const [denyOpen, setDenyOpen] = useState(false)
  const [denyNote, setDenyNote] = useState("")
  const [denyError, setDenyError] = useState<string | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const canApprove = status === "awaiting_approval"

  function handleApproveConfirm() {
    setApproveError(null)
    startTransition(async () => {
      const result = await approveAction(requestId)
      if (!result.ok) {
        setApproveError(result.error ?? "Approval failed.")
      } else {
        setApproveOpen(false)
      }
    })
  }

  function openDeny() {
    setDenyNote("")
    setDenyError(null)
    setDenyOpen(true)
    setTimeout(() => textareaRef.current?.focus(), 50)
  }

  function handleDeny() {
    setDenyError(null)
    startTransition(async () => {
      const result = await denyAction(requestId, denyNote)
      if (!result.ok) {
        setDenyError(result.error ?? "Denial failed.")
      } else {
        setDenyOpen(false)
      }
    })
  }

  return (
    <>
      <div className="flex flex-wrap items-center gap-3">
        {canApprove ? (
          <Button onClick={() => setApproveOpen(true)} disabled={isPending}>
            Approve
          </Button>
        ) : (
          <p className="text-sm text-muted-foreground">
            Approve is unavailable — the request must be processed by the worker and reach{" "}
            <span className="font-medium">Awaiting approval</span> first.
          </p>
        )}
        <Button variant="destructive" onClick={openDeny} disabled={isPending}>
          Deny
        </Button>
      </div>

      {/* Approve confirmation dialog */}
      {canApprove && approveOpen && (
        <div
          role="presentation"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
          onClick={(e) => {
            if (e.target === e.currentTarget) setApproveOpen(false)
          }}
          onKeyDown={(e) => {
            if (e.key === "Escape") setApproveOpen(false)
          }}
        >
          <div className="bg-background rounded-lg border shadow-lg w-full max-w-md p-6 space-y-4">
            <h2 className="text-base font-semibold">Confirm approval</h2>
            <p className="text-sm text-muted-foreground">
              These playlist filters will be saved as channel rules and applied to this ingest and
              all future scheduled ingests:
            </p>
            <p className="text-sm font-medium">{filterSummary(playlistFilters)}</p>
            {approveError && <p className="text-sm text-destructive">{approveError}</p>}
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setApproveOpen(false)} disabled={isPending}>
                Cancel
              </Button>
              <Button onClick={handleApproveConfirm} disabled={isPending}>
                Confirm approval
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Deny dialog */}
      {denyOpen && (
        <div
          role="presentation"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
          onClick={(e) => {
            if (e.target === e.currentTarget) setDenyOpen(false)
          }}
          onKeyDown={(e) => {
            if (e.key === "Escape") setDenyOpen(false)
          }}
        >
          <div className="bg-background rounded-lg border shadow-lg w-full max-w-md p-6 space-y-4">
            <h2 className="text-base font-semibold">Deny request</h2>
            <div className="space-y-1">
              <label htmlFor="admin-note" className="text-sm text-muted-foreground">
                Admin note <span className="text-destructive">*</span>
              </label>
              <textarea
                id="admin-note"
                ref={textareaRef}
                value={denyNote}
                onChange={(e) => setDenyNote(e.target.value)}
                maxLength={500}
                rows={4}
                placeholder="Reason for denial (shown to submitter)"
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring resize-none"
              />
              <p className="text-xs text-muted-foreground text-right">{denyNote.length}/500</p>
            </div>
            {denyError && <p className="text-sm text-destructive">{denyError}</p>}
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setDenyOpen(false)} disabled={isPending}>
                Cancel
              </Button>
              <Button
                variant="destructive"
                onClick={handleDeny}
                disabled={isPending || denyNote.trim().length === 0}
              >
                Deny request
              </Button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
