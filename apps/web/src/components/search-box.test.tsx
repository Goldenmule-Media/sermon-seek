import { fireEvent, render, screen } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { SearchBox } from "./search-box"

const mockPush = vi.fn()

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush }),
  useSearchParams: () => new URLSearchParams(),
}))

describe("SearchBox", () => {
  beforeEach(() => {
    mockPush.mockClear()
  })

  function submit(query: string) {
    render(<SearchBox />)
    const input = screen.getByPlaceholderText("Search sermons...")
    fireEvent.change(input, { target: { value: query } })
    fireEvent.submit(input.closest("form")!)
  }

  it("routes non-ref query to ?q=", () => {
    submit("grace")
    expect(mockPush).toHaveBeenCalledWith("/search?q=grace")
  })

  it("routes 'Romans 8' to ?ref=", () => {
    submit("Romans 8")
    expect(mockPush).toHaveBeenCalledWith("/search?ref=Romans%208")
  })

  it("routes '1 Corinthians 13:4-7' to ?ref=", () => {
    submit("1 Corinthians 13:4-7")
    expect(mockPush).toHaveBeenCalledWith("/search?ref=1%20Corinthians%2013%3A4-7")
  })

  it("routes lowercase ASR-style 'john 3 16' to ?ref=", () => {
    submit("john 3 16")
    expect(mockPush).toHaveBeenCalledWith("/search?ref=john%203%2016")
  })

  it("does not navigate on empty submit", () => {
    submit("")
    expect(mockPush).not.toHaveBeenCalled()
  })

  it("does not navigate on whitespace-only submit", () => {
    submit("   ")
    expect(mockPush).not.toHaveBeenCalled()
  })
})
