import type { SearchResponse } from "@sermon-search/types"
import { render, screen, waitFor } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import { SearchResults } from "./search-results"

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => ({
    get: (key: string) => {
      if (key === "ref") return "foo"
      return ""
    },
  }),
}))

vi.mock("@/lib/api", () => ({
  fetchSearch: vi.fn(),
}))

import { fetchSearch } from "@/lib/api"

const mockFetchSearch = fetchSearch as ReturnType<typeof vi.fn>

const emptyResponse: SearchResponse = {
  results: [],
  total: 0,
  took_ms: 0,
  scripture_refs: [],
  topics: [],
}

describe("SearchResults", () => {
  it("renders the API 400 error message when fetchSearch returns { error }", async () => {
    mockFetchSearch.mockResolvedValueOnce({ error: "no scripture reference found in query" })
    render(<SearchResults church="jubileestl" playlists={[]} />)
    await waitFor(() =>
      expect(screen.getByText("no scripture reference found in query")).toBeInTheDocument(),
    )
  })

  it("renders the format hint on zero results (regression guard)", async () => {
    mockFetchSearch.mockResolvedValueOnce(emptyResponse)
    render(<SearchResults church="jubileestl" playlists={[]} />)
    await waitFor(() =>
      expect(screen.getByText(/No results found for scripture reference/)).toBeInTheDocument(),
    )
  })
})
