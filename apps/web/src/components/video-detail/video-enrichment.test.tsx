import type { ScriptureRefDetail } from "@sermon-search/types"
import { fireEvent, render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import { VideoEnrichment } from "./video-enrichment"

vi.mock("next/link", () => ({
  default: ({
    href,
    children,
    className,
  }: { href: string; children: React.ReactNode; className?: string }) => (
    <a href={href} className={className}>
      {children}
    </a>
  ),
}))

function makeRef(overrides: Partial<ScriptureRefDetail> = {}): ScriptureRefDetail {
  return {
    book_id: 45,
    chapter_start: 8,
    verse_start: 1,
    chapter_end: 8,
    verse_end: 5,
    start_coord: 45008001,
    end_coord: 45008005,
    occurrences: 1,
    display: "Romans 8:1-5",
    ...overrides,
  }
}

describe("VideoEnrichment", () => {
  it("renders nothing when summary, topics, and refs are all empty", () => {
    const { container } = render(
      <VideoEnrichment summary="" topics={[]} scriptureRefs={[]} />,
    )
    expect(container.firstChild).toBeNull()
  })

  it("renders ref display text verbatim, never a reconstructed string", () => {
    const ref = makeRef({ display: "Romans 8:1-5" })
    render(<VideoEnrichment summary="" topics={[]} scriptureRefs={[ref]} />)
    expect(screen.getByText("Romans 8:1-5")).toBeInTheDocument()
  })

  it("does not show occurrence suffix when occurrences === 1", () => {
    const ref = makeRef({ occurrences: 1, display: "Romans 8" })
    render(<VideoEnrichment summary="" topics={[]} scriptureRefs={[ref]} />)
    const link = screen.getByRole("link", { name: "Romans 8" })
    expect(link.textContent).toBe("Romans 8")
  })

  it("shows ×N suffix when occurrences > 1", () => {
    const ref = makeRef({ occurrences: 3, display: "Romans 8:1-5" })
    render(<VideoEnrichment summary="" topics={[]} scriptureRefs={[ref]} />)
    expect(screen.getByText("Romans 8:1-5 ×3")).toBeInTheDocument()
  })

  it("links each ref to /search?ref=<encoded display>", () => {
    const ref = makeRef({ display: "Romans 8:1-5" })
    render(<VideoEnrichment summary="" topics={[]} scriptureRefs={[ref]} />)
    const link = screen.getByRole("link", { name: "Romans 8:1-5" })
    expect(link).toHaveAttribute("href", "/search?ref=Romans%208%3A1-5")
  })

  it("preserves the API-provided order without re-sorting", () => {
    const refs = [
      makeRef({ display: "John 3:16", book_id: 43, start_coord: 43003016, end_coord: 43003016 }),
      makeRef({ display: "Romans 8:1", book_id: 45, start_coord: 45008001, end_coord: 45008001 }),
    ]
    render(<VideoEnrichment summary="" topics={[]} scriptureRefs={refs} />)
    const links = screen.getAllByRole("link")
    expect(links[0]).toHaveAttribute("href", expect.stringContaining("John"))
    expect(links[1]).toHaveAttribute("href", expect.stringContaining("Romans"))
  })

  it("shows only the first 8 refs initially when more than 8 are passed", () => {
    const refs = Array.from({ length: 12 }, (_, i) =>
      makeRef({
        display: `Book ${i + 1}:1`,
        book_id: i + 1,
        start_coord: (i + 1) * 1000,
        end_coord: (i + 1) * 1000,
      }),
    )
    render(<VideoEnrichment summary="" topics={[]} scriptureRefs={refs} />)
    expect(screen.queryByText("Book 1:1")).toBeInTheDocument()
    expect(screen.queryByText("Book 8:1")).toBeInTheDocument()
    expect(screen.queryByText("Book 9:1")).not.toBeInTheDocument()
    expect(screen.queryByText("Book 12:1")).not.toBeInTheDocument()
  })

  it("reveals all refs after clicking show all", () => {
    const refs = Array.from({ length: 12 }, (_, i) =>
      makeRef({
        display: `Book ${i + 1}:1`,
        book_id: i + 1,
        start_coord: (i + 1) * 1000,
        end_coord: (i + 1) * 1000,
      }),
    )
    render(<VideoEnrichment summary="" topics={[]} scriptureRefs={refs} />)
    const btn = screen.getByRole("button", { name: /show all/ })
    fireEvent.click(btn)
    expect(screen.queryByText("Book 9:1")).toBeInTheDocument()
    expect(screen.queryByText("Book 12:1")).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: /show all/ })).not.toBeInTheDocument()
  })

  it("shows all refs without a collapse button when 8 or fewer refs are passed", () => {
    const refs = Array.from({ length: 8 }, (_, i) =>
      makeRef({
        display: `Book ${i + 1}:1`,
        book_id: i + 1,
        start_coord: (i + 1) * 1000,
        end_coord: (i + 1) * 1000,
      }),
    )
    render(<VideoEnrichment summary="" topics={[]} scriptureRefs={refs} />)
    expect(screen.queryByRole("button", { name: /show all/ })).not.toBeInTheDocument()
    expect(screen.queryByText("Book 8:1")).toBeInTheDocument()
  })
})
