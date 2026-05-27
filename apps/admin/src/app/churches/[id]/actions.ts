"use server"

import { adminFetch } from "@/lib/admin-api"
import { revalidatePath } from "next/cache"
import { notFound, redirect } from "next/navigation"

export interface FormState {
  status: "idle" | "error" | "success"
  message?: string
}

export async function renameChurchAction(
  _prevState: FormState,
  formData: FormData,
): Promise<FormState> {
  const id = formData.get("id") as string
  const currentSlug = formData.get("currentSlug") as string
  const currentName = formData.get("currentName") as string
  const slug = (formData.get("slug") as string).trim()
  const name = (formData.get("name") as string).trim()

  const body: Record<string, string> = {}
  if (slug !== currentSlug) body.slug = slug
  if (name !== currentName) body.name = name

  if (Object.keys(body).length === 0) {
    return { status: "idle" }
  }

  const res = await adminFetch(`/admin/churches/${encodeURIComponent(id)}`, {
    method: "PATCH",
    body: JSON.stringify(body),
  })

  if (res.status === 404) {
    notFound()
  }

  if (res.status === 409) {
    return { status: "error", message: "Slug already taken" }
  }

  if (res.status === 400) {
    const data = (await res.json()) as { error: string }
    return { status: "error", message: data.error }
  }

  if (!res.ok) {
    return { status: "error", message: "Unexpected error" }
  }

  revalidatePath("/churches")
  revalidatePath(`/churches/${id}`)

  if (body.slug) {
    redirect(`/churches/${id}`)
  }

  return { status: "success", message: "Saved" }
}

export async function refreshChurchAction(
  _prevState: FormState,
  formData: FormData,
): Promise<FormState> {
  const slug = formData.get("slug") as string

  const sp = new URLSearchParams({ churchSlug: slug })
  const res = await adminFetch(`/admin/ingest/refresh?${sp.toString()}`, {
    method: "POST",
  })

  if (!res.ok) {
    let message = "Refresh failed"
    try {
      const data = (await res.json()) as { error?: string }
      if (data.error) message = data.error
    } catch {
      // ignore
    }
    return { status: "error", message }
  }

  revalidatePath("/churches")

  return { status: "success", message: "Refresh complete" }
}
