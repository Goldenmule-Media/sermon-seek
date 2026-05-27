import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

// --- Mocks ---

const mockPush = vi.fn()

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush }),
}))

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

vi.mock("@/lib/use-user", () => ({
  useUser: vi.fn(),
}))

vi.mock("@/lib/auth", () => ({
  googleStartUrl: (returnTo: string) => `/v1/auth/google/start?return_to=${returnTo}`,
}))

vi.mock("@/lib/ingest-api", () => ({
  checkSlugAvailable: vi.fn(),
  fetchChannelPreflight: vi.fn(),
  postIngestionRequest: vi.fn(),
}))

import { checkSlugAvailable, fetchChannelPreflight, postIngestionRequest } from "@/lib/ingest-api"
import { useUser } from "@/lib/use-user"
import { IngestPage } from "./ingest-page"

const mockCheckSlug = checkSlugAvailable as ReturnType<typeof vi.fn>
const mockPreflight = fetchChannelPreflight as ReturnType<typeof vi.fn>
const mockPost = postIngestionRequest as ReturnType<typeof vi.fn>
const mockUseUser = useUser as ReturnType<typeof vi.fn>

const loggedInUser = { id: "u1", display_name: "Alice", avatar_url: null, is_admin: false }

// Generous timeout covers the longest debounce (500 ms) plus resolution.
const DEBOUNCE_TIMEOUT = 2000

afterEach(() => {
  vi.resetAllMocks()
})

// --- Tests ---

describe("IngestPage", () => {
  describe("logged-out gate", () => {
    it("renders only the sign-in CTA when user is null", () => {
      mockUseUser.mockReturnValue({ user: null, status: "ready", refresh: vi.fn() })
      render(<IngestPage />)

      expect(screen.getByText("Sign in with Google")).toBeInTheDocument()
      expect(screen.queryByLabelText("URL slug")).not.toBeInTheDocument()
    })

    it("renders a quiet placeholder while auth is loading", () => {
      mockUseUser.mockReturnValue({ user: null, status: "loading", refresh: vi.fn() })
      render(<IngestPage />)

      expect(screen.queryByText("Sign in with Google")).not.toBeInTheDocument()
      expect(screen.queryByLabelText("URL slug")).not.toBeInTheDocument()
    })
  })

  describe("logged-in form", () => {
    it("renders all required fields when signed in", () => {
      mockUseUser.mockReturnValue({ user: loggedInUser, status: "ready", refresh: vi.fn() })
      mockCheckSlug.mockResolvedValue("idle")
      mockPreflight.mockResolvedValue(null)
      render(<IngestPage />)

      expect(screen.getByLabelText("URL slug")).toBeInTheDocument()
      expect(screen.getByLabelText("Church name")).toBeInTheDocument()
      expect(screen.getByLabelText("YouTube handle or URL")).toBeInTheDocument()
      expect(screen.getByLabelText("Contact email")).toBeInTheDocument()
    })

    it("submit button is disabled when fields are empty", () => {
      mockUseUser.mockReturnValue({ user: loggedInUser, status: "ready", refresh: vi.fn() })
      render(<IngestPage />)

      expect(screen.getByRole("button", { name: /submit request/i })).toBeDisabled()
    })
  })

  describe("slug availability", () => {
    it("shows 'Available' when slug check returns available", async () => {
      mockUseUser.mockReturnValue({ user: loggedInUser, status: "ready", refresh: vi.fn() })
      mockCheckSlug.mockResolvedValue("available")
      mockPreflight.mockResolvedValue(null)
      render(<IngestPage />)

      fireEvent.change(screen.getByLabelText("URL slug"), { target: { value: "my-church" } })

      await waitFor(() => expect(screen.getByText("Available")).toBeInTheDocument(), {
        timeout: DEBOUNCE_TIMEOUT,
      })
    })

    it("shows taken error when slug check returns taken", async () => {
      mockUseUser.mockReturnValue({ user: loggedInUser, status: "ready", refresh: vi.fn() })
      mockCheckSlug.mockResolvedValue("taken")
      mockPreflight.mockResolvedValue(null)
      render(<IngestPage />)

      fireEvent.change(screen.getByLabelText("URL slug"), { target: { value: "taken-slug" } })

      await waitFor(
        () => expect(screen.getByText("That slug is already taken.")).toBeInTheDocument(),
        { timeout: DEBOUNCE_TIMEOUT },
      )
    })
  })

  describe("channel preflight callouts", () => {
    async function renderWithPreflight(preflightResult: unknown) {
      mockUseUser.mockReturnValue({ user: loggedInUser, status: "ready", refresh: vi.fn() })
      mockCheckSlug.mockResolvedValue("available")
      mockPreflight.mockResolvedValue(preflightResult)
      render(<IngestPage />)

      fireEvent.change(screen.getByLabelText("YouTube handle or URL"), {
        target: { value: "@TestChannel" },
      })

      // Wait for the preflight debounce to fire and the result to render.
      await waitFor(() => expect(mockPreflight).toHaveBeenCalled(), {
        timeout: DEBOUNCE_TIMEOUT,
      })
    }

    it("already_ingested — shows 'Go to existing search' CTA and disables submit", async () => {
      await renderWithPreflight({
        state: "already_ingested",
        existing_slug: "testchurch",
        search_url: "/testchurch/",
      })

      await waitFor(() => expect(screen.getByText("Go to existing search")).toBeInTheDocument())
      expect(screen.getByRole("button", { name: /submit request/i })).toBeDisabled()
    })

    it("request_in_flight + is_yours:true — links to /me/requests/<id> and disables submit", async () => {
      await renderWithPreflight({
        state: "request_in_flight",
        existing_slug: "testchurch",
        search_url: "/testchurch/",
        is_yours: true,
        request_id: "req-123",
      })

      await waitFor(() => expect(screen.getByText("View its status")).toBeInTheDocument())
      expect(screen.getByText("View its status").closest("a")).toHaveAttribute(
        "href",
        "/me/requests/req-123",
      )
      expect(screen.getByRole("button", { name: /submit request/i })).toBeDisabled()
    })

    it("request_in_flight + is_yours:false — shows neutral wait copy and disables submit", async () => {
      await renderWithPreflight({
        state: "request_in_flight",
        existing_slug: "testchurch",
        search_url: "/testchurch/",
        is_yours: false,
      })

      await waitFor(() => expect(screen.getByText(/already in progress/i)).toBeInTheDocument())
      expect(screen.getByRole("button", { name: /submit request/i })).toBeDisabled()
    })

    it("channel_unavailable — shows admin-attention note and disables submit", async () => {
      await renderWithPreflight({ state: "channel_unavailable" })

      await waitFor(() => expect(screen.getByText(/admin attention/i)).toBeInTheDocument())
      expect(screen.getByRole("button", { name: /submit request/i })).toBeDisabled()
    })

    it("unknown_handle — shows unresolved error, hides playlist picker, disables submit", async () => {
      await renderWithPreflight({ state: "unknown_handle" })

      await waitFor(() => expect(screen.getByText(/couldn't resolve/i)).toBeInTheDocument())
      expect(screen.queryByText(/playlist filters/i)).not.toBeInTheDocument()
      expect(screen.getByRole("button", { name: /submit request/i })).toBeDisabled()
    })

    it("available — shows playlist picker", async () => {
      await renderWithPreflight({ state: "available", youtube_channel_id: "UCtest" })

      await waitFor(() => expect(screen.getByText(/playlist filters/i)).toBeInTheDocument())
    })
  })

  describe("POST submission", () => {
    async function setupReadyToSubmit() {
      mockUseUser.mockReturnValue({ user: loggedInUser, status: "ready", refresh: vi.fn() })
      mockCheckSlug.mockResolvedValue("available")
      mockPreflight.mockResolvedValue({ state: "available", youtube_channel_id: "UCtest" })
      render(<IngestPage />)

      fireEvent.change(screen.getByLabelText("URL slug"), { target: { value: "my-church" } })
      fireEvent.change(screen.getByLabelText("Church name"), { target: { value: "My Church" } })
      fireEvent.change(screen.getByLabelText("YouTube handle or URL"), {
        target: { value: "@MyChurch" },
      })
      fireEvent.change(screen.getByLabelText("Contact email"), {
        target: { value: "me@example.com" },
      })

      // Wait for both debounced calls to settle.
      await waitFor(() => expect(screen.getByText("Available")).toBeInTheDocument(), {
        timeout: DEBOUNCE_TIMEOUT,
      })
      await waitFor(() => expect(screen.getByText(/playlist filters/i)).toBeInTheDocument(), {
        timeout: DEBOUNCE_TIMEOUT,
      })
    }

    it("navigates to status_url on 201", async () => {
      await setupReadyToSubmit()
      mockPost.mockResolvedValueOnce({
        status: 201,
        request_id: "req-1",
        status_url: "/me/requests/req-1",
        search_url: "/my-church/",
      })

      const submitBtn = screen.getByRole("button", { name: /submit request/i })
      fireEvent.submit(submitBtn.closest("form") ?? submitBtn)

      await waitFor(() => expect(mockPush).toHaveBeenCalledWith("/me/requests/req-1"))
    })

    it("rebuilds callout and disables submit on POST 409 (race protection)", async () => {
      await setupReadyToSubmit()
      mockPost.mockResolvedValueOnce({
        status: 409,
        error: "channel_already_ingested",
        existing_slug: "testchurch",
        search_url: "/testchurch/",
      })

      const submitBtn = screen.getByRole("button", { name: /submit request/i })
      fireEvent.submit(submitBtn.closest("form") ?? submitBtn)

      await waitFor(() => expect(screen.getByText("Go to existing search")).toBeInTheDocument())
      expect(screen.getByRole("button", { name: /submit request/i })).toBeDisabled()
    })
  })
})
