import type { AuthMeResponse } from "@sermon-search/types"
import { apiBase } from "./api"

function meUrl(): string {
  return `${apiBase()}/v1/me`
}

function logoutUrl(): string {
  return `${apiBase()}/v1/auth/logout`
}

export function googleStartUrl(returnTo: string): string {
  const sp = new URLSearchParams({ return_to: returnTo })
  return `${apiBase()}/v1/auth/google/start?${sp.toString()}`
}

export async function fetchMe(signal?: AbortSignal): Promise<AuthMeResponse | null> {
  try {
    const res = await fetch(meUrl(), { credentials: "include", signal })
    if (res.status === 401) return null
    if (!res.ok) return null
    return res.json() as Promise<AuthMeResponse>
  } catch {
    return null
  }
}

export async function postLogout(): Promise<void> {
  try {
    await fetch(logoutUrl(), {
      method: "POST",
      credentials: "include",
      headers: { "X-Sermon-CSRF": "1" },
    })
  } catch {
    // ignore — caller refreshes state regardless
  }
}
