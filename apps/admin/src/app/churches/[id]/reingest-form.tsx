"use client"

import { Button } from "@/components/ui/button"
import { useActionState } from "react"
import { useFormStatus } from "react-dom"
import { type FormState, reingestChurchAction } from "./actions"

function SubmitButton({
  mode,
  label,
  pendingLabel,
  variant,
}: {
  mode: "full" | "incremental"
  label: string
  pendingLabel: string
  variant: "default" | "outline"
}) {
  const { pending } = useFormStatus()
  return (
    <Button
      type="submit"
      name="mode"
      value={mode}
      disabled={pending}
      variant={variant}
      size="sm"
      // A full re-ingest of a large channel is expensive and rarely what is
      // wanted, so make it the deliberate one of the two.
      onClick={(e) => {
        if (
          mode === "full" &&
          !window.confirm(
            "Re-check every video in this church, including ones already ingested. This can take a long time on a large channel. Continue?",
          )
        ) {
          e.preventDefault()
        }
      }}
    >
      {pending ? pendingLabel : label}
    </Button>
  )
}

export function ReingestForm({ id, slug }: { id: string; slug: string }) {
  const [state, action] = useActionState<FormState, FormData>(reingestChurchAction, {
    status: "idle",
  })

  return (
    <form action={action} className="flex flex-wrap items-center gap-3">
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="slug" value={slug} />
      <SubmitButton
        mode="incremental"
        label="Ingest new videos"
        pendingLabel="Queueing…"
        variant="default"
      />
      <SubmitButton mode="full" label="Full re-ingest" pendingLabel="Queueing…" variant="outline" />
      {state.status === "error" && (
        <span className="text-sm text-destructive">{state.message}</span>
      )}
      {state.status === "success" && (
        <span className="text-sm text-green-600">{state.message}</span>
      )}
    </form>
  )
}
