"use client"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { useActionState } from "react"
import { useFormStatus } from "react-dom"
import { type FormState, renameChurchAction } from "./actions"

function SubmitButton() {
  const { pending } = useFormStatus()
  return (
    <Button type="submit" disabled={pending} size="sm">
      {pending ? "Saving…" : "Save"}
    </Button>
  )
}

export function RenameForm({
  id,
  currentSlug,
  currentName,
}: {
  id: string
  currentSlug: string
  currentName: string
}) {
  const [state, action] = useActionState<FormState, FormData>(renameChurchAction, {
    status: "idle",
  })

  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="currentSlug" value={currentSlug} />
      <input type="hidden" name="currentName" value={currentName} />

      <div className="grid gap-1.5">
        <label htmlFor="rename-slug" className="text-sm font-medium">
          Slug
        </label>
        <Input
          id="rename-slug"
          name="slug"
          defaultValue={currentSlug}
          className="max-w-xs font-mono"
          required
        />
      </div>

      <div className="grid gap-1.5">
        <label htmlFor="rename-name" className="text-sm font-medium">
          Display name
        </label>
        <Input
          id="rename-name"
          name="name"
          defaultValue={currentName}
          className="max-w-sm"
          required
        />
      </div>

      {state.status === "error" && <p className="text-sm text-destructive">{state.message}</p>}
      {state.status === "success" && <p className="text-sm text-green-600">{state.message}</p>}

      <SubmitButton />
    </form>
  )
}
