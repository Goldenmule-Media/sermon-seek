function apiBase(): string {
  return process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001"
}

export function googleStartUrl(returnTo: string): string {
  const sp = new URLSearchParams({ return_to: returnTo })
  return `${apiBase()}/v1/auth/google/start?${sp.toString()}`
}

export async function postLogout(): Promise<void> {
  try {
    await fetch(`${apiBase()}/v1/auth/logout`, {
      method: "POST",
      credentials: "include",
      headers: { "X-Sermon-CSRF": "1" },
    })
  } catch {
    // ignore — caller handles UI state
  }
}
