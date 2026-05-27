"use server"

import { adminFetch } from "@/lib/admin-api"
import { revalidatePath } from "next/cache"

export interface FormState {
  status: "idle" | "error" | "success"
  message?: string
}

export async function retranscribeVideoAction(
  _prevState: FormState,
  formData: FormData,
): Promise<FormState> {
  const youtubeId = formData.get("youtubeId") as string
  const churchSlug = formData.get("churchSlug") as string

  const res = await adminFetch(`/admin/videos/${encodeURIComponent(youtubeId)}/retranscribe`, {
    method: "POST",
    body: JSON.stringify({ churchSlug }),
  })

  if (res.status === 404) {
    return { status: "error", message: "Video not found" }
  }

  if (res.status === 422) {
    return { status: "error", message: "No captions available for this video" }
  }

  if (!res.ok) {
    return { status: "error", message: `Retranscribe failed (${res.status})` }
  }

  revalidatePath("/videos")
  return { status: "success", message: "Retranscribed" }
}
