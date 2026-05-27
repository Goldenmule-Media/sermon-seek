"use client"

import { Button } from "@/components/ui/button"
import { useRef, useState, useTransition } from "react"
import { approveAction, denyAction } from "./actions"

interface Props {
  requestId: string
}

export function ApproveDenyButtons({ requestId }: Props) {
  const [isPending, startTransition] = useTransition()
  const [approveError, setApproveError] = useState<string | null>(null)
  const [denyOpen, setDenyOpen] = useState(false)
  const [denyNote, setDenyNote] = useState("")
  const [denyError, setDenyError] = useState<string | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  function handleApprove() {
    setApproveError(null)
    startTransition(async () => {
      const result = await approveAction(requestId)
      if (!result.ok) setApproveError(result.error ?? "Approval failed.")
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
      <div className="flex gap-3">
        <Button onClick={handleApprove} disabled={isPending}>
          Approve
        </Button>
        <Button variant="destructive" onClick={openDeny} disabled={isPending}>
          Deny
        </Button>
      </div>

      {approveError && <p className="text-sm text-destructive mt-1">{approveError}</p>}

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
