"use client"

import { Button } from "@/components/ui/button"
import { useActionState } from "react"
import { useFormStatus } from "react-dom"
import { type FormState, retranscribeVideoAction } from "./actions"

function SubmitButton() {
  const { pending } = useFormStatus()
  return (
    <Button type="submit" disabled={pending} variant="outline" size="sm">
      {pending ? "…" : "Retranscribe"}
    </Button>
  )
}

export function RetranscribeButton({
  youtubeId,
  churchSlug,
}: {
  youtubeId: string
  churchSlug: string
}) {
  const [state, action] = useActionState<FormState, FormData>(retranscribeVideoAction, {
    status: "idle",
  })

  return (
    <div className="flex flex-col items-start gap-1">
      <form action={action}>
        <input type="hidden" name="youtubeId" value={youtubeId} />
        <input type="hidden" name="churchSlug" value={churchSlug} />
        <SubmitButton />
      </form>
      {state.status === "error" && (
        <span className="text-xs text-destructive">{state.message}</span>
      )}
      {state.status === "success" && (
        <span className="text-xs text-green-600">{state.message}</span>
      )}
    </div>
  )
}
