import type { HomeResponse } from "@sermon-search/types"

function apiBase(): string {
  return process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001"
}

export async function fetchHome(): Promise<HomeResponse> {
  try {
    const res = await fetch(`${apiBase()}/v1/home`, {
      next: { revalidate: 60 },
    })
    if (!res.ok) return { recent: [], top_playlists: [] }
    return res.json() as Promise<HomeResponse>
  } catch {
    return { recent: [], top_playlists: [] }
  }
}
