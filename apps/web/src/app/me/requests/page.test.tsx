import type { MeRequestsListResponse } from "@sermon-search/types"
import { render, screen, waitFor } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"

vi.mock("next/link", () => ({
  default: ({
    href,
    children,
    className,
  }: {
    href: string
    children: React.ReactNode
    className?: string
  }) => (
    <a href={href} className={className}>
      {children}
    </a>
  ),
}))

vi.mock("next/navigation", () => ({
  usePathname: () => "/me/requests",
  useSearchParams: () => new URLSearchParams(),
}))

vi.mock("@/lib/api", () => ({
  fetchMyRequests: vi.fn(),
}))

vi.mock("@/lib/auth", () => ({
  googleStartUrl: (returnTo: string) => `/v1/auth/google/start?return_to=${returnTo}`,
  fetchMe: vi.fn(),
}))

vi.mock("@/lib/use-user", () => ({
  useUser: vi.fn(),
}))

import { fetchMyRequests } from "@/lib/api"
import { useUser } from "@/lib/use-user"
import MyRequestsPage from "./page"

const mockFetchMyRequests = fetchMyRequests as ReturnType<typeof vi.fn>
const mockUseUser = useUser as ReturnType<typeof vi.fn>

function makeRequest(
  overrides: Partial<MeRequestsListResponse["requests"][number]> = {},
): MeRequestsListResponse["requests"][number] {
  return {
    id: "req-1",
    requested_slug: "testchurch",
    status: "running",
    videos_discovered: 42,
    videos_ingested: 17,
    tokens_ingested: 5000,
    tokens_cap: 100000,
    search_url: "/testchurch/",
    limit_reached: false,
    created_at: new Date("2026-01-01T12:00:00Z").toISOString(),
    ...overrides,
  }
}

describe("MyRequestsPage", () => {
  it("renders sign-in CTA when user is not authenticated", async () => {
    mockUseUser.mockReturnValue({ user: null, status: "ready", refresh: vi.fn() })

    render(<MyRequestsPage />)

    await waitFor(() => expect(screen.getByText(/Sign in to view/)).toBeInTheDocument())
    expect(screen.getByRole("link", { name: /Sign in with Google/i })).toBeInTheDocument()
  })

  it("renders empty state when user has no requests", async () => {
    mockUseUser.mockReturnValue({
      user: { id: "u1", display_name: "Alice", avatar_url: null, is_admin: false },
      status: "ready",
      refresh: vi.fn(),
    })
    mockFetchMyRequests.mockResolvedValueOnce({ requests: [], total: 0, limit: 20, offset: 0 })

    render(<MyRequestsPage />)

    await waitFor(() => expect(screen.getByText(/haven't submitted/)).toBeInTheDocument())
    expect(screen.getByRole("link", { name: /Submit one now/i })).toHaveAttribute("href", "/ingest")
  })

  it("renders a row for each request", async () => {
    mockUseUser.mockReturnValue({
      user: { id: "u1", display_name: "Alice", avatar_url: null, is_admin: false },
      status: "ready",
      refresh: vi.fn(),
    })
    const requests = [
      makeRequest({ id: "req-1", requested_slug: "churchone", status: "running" }),
      makeRequest({ id: "req-2", requested_slug: "churchtwo", status: "complete" }),
    ]
    mockFetchMyRequests.mockResolvedValueOnce({ requests, total: 2, limit: 20, offset: 0 })

    render(<MyRequestsPage />)

    await waitFor(() => expect(screen.getByText("/churchone/")).toBeInTheDocument())
    expect(screen.getByText("/churchtwo/")).toBeInTheDocument()

    const links = screen
      .getAllByRole("link")
      .filter((l) => l.getAttribute("href")?.startsWith("/me/requests/"))
    expect(links).toHaveLength(2)
    expect(links[0]).toHaveAttribute("href", "/me/requests/req-1")
    expect(links[1]).toHaveAttribute("href", "/me/requests/req-2")
  })

  it("shows status badges", async () => {
    mockUseUser.mockReturnValue({
      user: { id: "u1", display_name: "Alice", avatar_url: null, is_admin: false },
      status: "ready",
      refresh: vi.fn(),
    })
    mockFetchMyRequests.mockResolvedValueOnce({
      requests: [makeRequest({ status: "awaiting_approval" })],
      total: 1,
      limit: 20,
      offset: 0,
    })

    render(<MyRequestsPage />)

    await waitFor(() => expect(screen.getByText("awaiting approval")).toBeInTheDocument())
  })

  it("shows counters", async () => {
    mockUseUser.mockReturnValue({
      user: { id: "u1", display_name: "Alice", avatar_url: null, is_admin: false },
      status: "ready",
      refresh: vi.fn(),
    })
    mockFetchMyRequests.mockResolvedValueOnce({
      requests: [
        makeRequest({
          videos_ingested: 17,
          videos_discovered: 42,
          tokens_ingested: 5000,
          tokens_cap: 100000,
        }),
      ],
      total: 1,
      limit: 20,
      offset: 0,
    })

    render(<MyRequestsPage />)

    await waitFor(() => expect(screen.getByText(/17 \/ 42 videos/)).toBeInTheDocument())
  })

  it("renders error state when fetch fails", async () => {
    mockUseUser.mockReturnValue({
      user: { id: "u1", display_name: "Alice", avatar_url: null, is_admin: false },
      status: "ready",
      refresh: vi.fn(),
    })
    mockFetchMyRequests.mockResolvedValueOnce(null)

    render(<MyRequestsPage />)

    await waitFor(() => expect(screen.getByText(/Failed to load/)).toBeInTheDocument())
  })
})
