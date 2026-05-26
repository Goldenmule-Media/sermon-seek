import type { IngestionRequestDetail } from "@sermon-search/types"
import { render, screen, waitFor } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

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
  useParams: vi.fn(),
}))

vi.mock("@/lib/api", () => ({
  fetchMyRequest: vi.fn(),
}))

vi.mock("@/lib/auth", () => ({
  googleStartUrl: (returnTo: string) => `/v1/auth/google/start?return_to=${returnTo}`,
  fetchMe: vi.fn(),
}))

vi.mock("@/lib/use-user", () => ({
  useUser: vi.fn(),
}))

import { fetchMyRequest } from "@/lib/api"
import { useUser } from "@/lib/use-user"
import { useParams } from "next/navigation"
import RequestDetailPage from "./page"

const mockFetchMyRequest = fetchMyRequest as ReturnType<typeof vi.fn>
const mockUseUser = useUser as ReturnType<typeof vi.fn>
const mockUseParams = useParams as ReturnType<typeof vi.fn>

function makeDetail(overrides: Partial<IngestionRequestDetail> = {}): IngestionRequestDetail {
  return {
    id: "req-1",
    requested_slug: "testchurch",
    requested_name: "Test Church",
    youtube_handle_or_url: "@TestChurch",
    contact_email: "test@example.com",
    include_playlist_ids: [],
    exclude_playlist_ids: [],
    status: "running",
    videos_discovered: 42,
    videos_ingested: 17,
    tokens_ingested: 5000,
    tokens_cap: 100000,
    search_url: "/testchurch/",
    limit_reached: false,
    admin_note: null,
    created_at: new Date("2026-01-01T12:00:00Z").toISOString(),
    updated_at: new Date("2026-01-01T13:00:00Z").toISOString(),
    ...overrides,
  }
}

beforeEach(() => {
  mockUseParams.mockReturnValue({ id: "req-1" })
})

afterEach(() => {
  vi.clearAllMocks()
})

describe("RequestDetailPage", () => {
  it("shows sign-in CTA when unauthenticated", async () => {
    mockUseUser.mockReturnValue({ user: null, status: "ready", refresh: vi.fn() })

    render(<RequestDetailPage />)

    await waitFor(() =>
      expect(screen.getByText(/Sign in to view this request/)).toBeInTheDocument(),
    )
    expect(screen.getByRole("link", { name: /Sign in with Google/i })).toBeInTheDocument()
  })

  it("shows forbidden message on 403", async () => {
    mockUseUser.mockReturnValue({
      user: { id: "u1", display_name: "Alice", avatar_url: null, is_admin: false },
      status: "ready",
      refresh: vi.fn(),
    })
    mockFetchMyRequest.mockResolvedValueOnce({ status: 403, body: { error: "forbidden" } })

    render(<RequestDetailPage />)

    await waitFor(() =>
      expect(screen.getByText(/doesn't exist or isn't yours/)).toBeInTheDocument(),
    )
  })

  it("shows forbidden message on 404", async () => {
    mockUseUser.mockReturnValue({
      user: { id: "u1", display_name: "Alice", avatar_url: null, is_admin: false },
      status: "ready",
      refresh: vi.fn(),
    })
    mockFetchMyRequest.mockResolvedValueOnce({ status: 404, body: { error: "not_found" } })

    render(<RequestDetailPage />)

    await waitFor(() =>
      expect(screen.getByText(/doesn't exist or isn't yours/)).toBeInTheDocument(),
    )
  })

  it("renders live-link callout with indexing annotation while running", async () => {
    mockUseUser.mockReturnValue({
      user: { id: "u1", display_name: "Alice", avatar_url: null, is_admin: false },
      status: "ready",
      refresh: vi.fn(),
    })
    mockFetchMyRequest.mockResolvedValue({ status: 200, body: makeDetail() })

    render(<RequestDetailPage />)

    await waitFor(() =>
      expect(screen.getByText(/Your sermon search will live at/)).toBeInTheDocument(),
    )

    const link = screen.getByRole("link", { name: "/testchurch/" })
    expect(link).toHaveAttribute("href", "/testchurch/")
    expect(screen.getByText(/indexing… 17 of 42 videos/)).toBeInTheDocument()
  })

  it("shows preparing when videos_discovered is 0", async () => {
    mockUseUser.mockReturnValue({
      user: { id: "u1", display_name: "Alice", avatar_url: null, is_admin: false },
      status: "ready",
      refresh: vi.fn(),
    })
    mockFetchMyRequest.mockResolvedValue({
      status: 200,
      body: makeDetail({ videos_discovered: 0, videos_ingested: 0 }),
    })

    render(<RequestDetailPage />)

    await waitFor(() => expect(screen.getByText(/preparing…/)).toBeInTheDocument())
  })

  it("shows live now badge when complete", async () => {
    mockUseUser.mockReturnValue({
      user: { id: "u1", display_name: "Alice", avatar_url: null, is_admin: false },
      status: "ready",
      refresh: vi.fn(),
    })
    mockFetchMyRequest.mockResolvedValue({
      status: 200,
      body: makeDetail({ status: "complete" }),
    })

    render(<RequestDetailPage />)

    await waitFor(() => expect(screen.getByText("live now")).toBeInTheDocument())
  })

  it("falls back to /<slug>/ when search_url is null", async () => {
    mockUseUser.mockReturnValue({
      user: { id: "u1", display_name: "Alice", avatar_url: null, is_admin: false },
      status: "ready",
      refresh: vi.fn(),
    })
    mockFetchMyRequest.mockResolvedValue({
      status: 200,
      body: makeDetail({ search_url: null }),
    })

    render(<RequestDetailPage />)

    await waitFor(() =>
      expect(screen.getByRole("link", { name: "/testchurch/" })).toHaveAttribute(
        "href",
        "/testchurch/",
      ),
    )
  })

  it("polls every 10 seconds", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    try {
      mockUseUser.mockReturnValue({
        user: { id: "u1", display_name: "Alice", avatar_url: null, is_admin: false },
        status: "ready",
        refresh: vi.fn(),
      })
      mockFetchMyRequest.mockResolvedValue({ status: 200, body: makeDetail() })

      render(<RequestDetailPage />)

      // let the initial fetch settle
      await vi.advanceTimersByTimeAsync(100)
      const callsAfterMount = mockFetchMyRequest.mock.calls.length
      expect(callsAfterMount).toBeGreaterThanOrEqual(1)

      // advance two poll cycles
      await vi.advanceTimersByTimeAsync(20_000)
      expect(mockFetchMyRequest.mock.calls.length).toBeGreaterThanOrEqual(callsAfterMount + 2)
    } finally {
      vi.useRealTimers()
    }
  })

  it("shows amber warning when limit_reached is true", async () => {
    mockUseUser.mockReturnValue({
      user: { id: "u1", display_name: "Alice", avatar_url: null, is_admin: false },
      status: "ready",
      refresh: vi.fn(),
    })
    mockFetchMyRequest.mockResolvedValue({
      status: 200,
      body: makeDetail({ limit_reached: true, status: "awaiting_approval" }),
    })

    render(<RequestDetailPage />)

    await waitFor(() => expect(screen.getByText(/Token cap reached/)).toBeInTheDocument())
  })
})
