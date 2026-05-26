"use client"

import type { AuthMeResponse } from "@sermon-search/types"
import { useCallback, useEffect, useState } from "react"
import { fetchMe } from "./auth"

type UserStatus = "loading" | "ready"

export interface UseUserResult {
  user: AuthMeResponse | null
  status: UserStatus
  refresh: () => Promise<void>
}

export function useUser(): UseUserResult {
  const [user, setUser] = useState<AuthMeResponse | null>(null)
  const [status, setStatus] = useState<UserStatus>("loading")

  const load = useCallback(async (signal?: AbortSignal) => {
    const result = await fetchMe(signal)
    if (signal?.aborted) return
    setUser(result)
    setStatus("ready")
  }, [])

  useEffect(() => {
    const controller = new AbortController()
    load(controller.signal)
    return () => controller.abort()
  }, [load])

  const refresh = useCallback(async () => {
    await load()
  }, [load])

  return { user, status, refresh }
}
