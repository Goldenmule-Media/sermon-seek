"use client"

import { Button } from "@/components/ui/button"
import { useActionState } from "react"
import { useFormStatus } from "react-dom"
import { type FormState, refreshChurchAction } from "./actions"

function SubmitButton() {
  const { pending } = useFormStatus()
  return (
    <Button type="submit" disabled={pending} variant="outline" size="sm">
      {pending ? "Refreshing…" : "Refresh"}
    </Button>
  )
}

export function RefreshForm({ slug }: { slug: string }) {
  const [state, action] = useActionState<FormState, FormData>(refreshChurchAction, {
    status: "idle",
  })

  return (
    <form action={action} className="flex items-center gap-3">
      <input type="hidden" name="slug" value={slug} />
      <SubmitButton />
      {state.status === "error" && (
        <span className="text-sm text-destructive">{state.message}</span>
      )}
      {state.status === "success" && (
        <span className="text-sm text-green-600">{state.message}</span>
      )}
    </form>
  )
}
