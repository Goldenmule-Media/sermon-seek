"use client"

import { Button } from "@/components/ui/button"
import { useActionState } from "react"
import { useFormStatus } from "react-dom"
import { type FormState, reingestChurchAction } from "./actions"

const FULL_CONFIRM =
  "Re-check every video in this church, including ones already ingested. This can take a long time on a large channel. Continue?"

function SubmitButton({
  label,
  pendingLabel,
  variant,
  confirmMessage,
}: {
  label: string
  pendingLabel: string
  variant: "default" | "outline"
  confirmMessage?: string
}) {
  const { pending } = useFormStatus()
  return (
    <Button
      type="submit"
      disabled={pending}
      variant={variant}
      size="sm"
      onClick={(e) => {
        if (confirmMessage && !window.confirm(confirmMessage)) e.preventDefault()
      }}
    >
      {pending ? pendingLabel : label}
    </Button>
  )
}

/**
 * One form per mode, each carrying its mode in a hidden input.
 *
 * The two buttons previously shared a single form and distinguished themselves
 * by the submitter's name/value. That value did not survive into the action's
 * FormData, so every click — including "Ingest new videos" — arrived as a full
 * re-ingest. A hidden input is submitted by the form itself and does not depend
 * on which element triggered the submit.
 */
function ReingestButton({
  id,
  slug,
  mode,
  label,
  variant,
  confirmMessage,
}: {
  id: string
  slug: string
  mode: "full" | "incremental"
  label: string
  variant: "default" | "outline"
  confirmMessage?: string
}) {
  const [state, action] = useActionState<FormState, FormData>(reingestChurchAction, {
    status: "idle",
  })

  return (
    <form action={action} className="flex items-center gap-3">
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="slug" value={slug} />
      <input type="hidden" name="mode" value={mode} />
      <SubmitButton
        label={label}
        pendingLabel="Queueing…"
        variant={variant}
        confirmMessage={confirmMessage}
      />
      {state.status === "error" && (
        <span className="text-sm text-destructive">{state.message}</span>
      )}
      {state.status === "success" && (
        <span className="text-sm text-green-600">{state.message}</span>
      )}
    </form>
  )
}

export function ReingestForm({ id, slug }: { id: string; slug: string }) {
  return (
    <div className="flex flex-wrap items-center gap-4">
      <ReingestButton
        id={id}
        slug={slug}
        mode="incremental"
        label="Ingest new videos"
        variant="default"
      />
      <ReingestButton
        id={id}
        slug={slug}
        mode="full"
        label="Full re-ingest"
        variant="outline"
        confirmMessage={FULL_CONFIRM}
      />
    </div>
  )
}
