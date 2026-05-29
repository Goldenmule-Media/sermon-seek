"use server"

import { approveAdminRequest, denyAdminRequest, retryAdminRequest } from "@/lib/api"
import { revalidatePath } from "next/cache"

export async function approveAction(id: string): Promise<{ ok: boolean; error?: string }> {
  const result = await approveAdminRequest(id)
  if (!result.ok) return { ok: false, error: result.error }
  revalidatePath("/requests")
  revalidatePath(`/requests/${id}`)
  return { ok: true }
}

export async function denyAction(
  id: string,
  note: string,
): Promise<{ ok: boolean; error?: string }> {
  if (!note || note.length < 1 || note.length > 500) {
    return { ok: false, error: "Note must be 1–500 characters." }
  }
  const result = await denyAdminRequest(id, note)
  if (!result.ok) return { ok: false, error: result.error }
  revalidatePath("/requests")
  revalidatePath(`/requests/${id}`)
  return { ok: true }
}

export async function retryAction(id: string): Promise<{ ok: boolean; error?: string }> {
  const result = await retryAdminRequest(id)
  if (!result.ok) return { ok: false, error: result.error }
  revalidatePath("/requests")
  revalidatePath(`/requests/${id}`)
  return { ok: true }
}
