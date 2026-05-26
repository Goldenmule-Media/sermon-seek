import { renderHook, waitFor } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { useUser } from "./use-user"

const mockFetch = vi.fn()
vi.stubGlobal("fetch", mockFetch)

afterEach(() => {
  mockFetch.mockReset()
})

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  })
}

describe("useUser", () => {
  it("returns user when /v1/me resolves with 200", async () => {
    const user = { id: "u1", display_name: "Alice", avatar_url: null, is_admin: false }
    mockFetch.mockResolvedValue(jsonResponse(user))

    const { result } = renderHook(() => useUser())
    expect(result.current.status).toBe("loading")

    await waitFor(() => expect(result.current.status).toBe("ready"))
    expect(result.current.user).toEqual(user)
  })

  it("returns null user when /v1/me returns 401", async () => {
    mockFetch.mockResolvedValue(jsonResponse({ error: "unauthenticated" }, 401))

    const { result } = renderHook(() => useUser())
    await waitFor(() => expect(result.current.status).toBe("ready"))
    expect(result.current.user).toBeNull()
  })

  it("returns null user on network error", async () => {
    mockFetch.mockRejectedValue(new TypeError("network error"))

    const { result } = renderHook(() => useUser())
    await waitFor(() => expect(result.current.status).toBe("ready"))
    expect(result.current.user).toBeNull()
  })
})
