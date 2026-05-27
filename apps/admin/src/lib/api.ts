import { cookies } from "next/headers"

const ADMIN_API_URL = process.env.ADMIN_API_URL ?? "http://localhost:3001"

export async function adminApiFetch(path: string, init?: RequestInit): Promise<Response> {
  const cookieHeader = (await cookies()).toString()
  return fetch(`${ADMIN_API_URL}${path}`, {
    ...init,
    cache: "no-store",
    headers: {
      ...(init?.headers as Record<string, string> | undefined),
      cookie: cookieHeader,
    },
  })
}
