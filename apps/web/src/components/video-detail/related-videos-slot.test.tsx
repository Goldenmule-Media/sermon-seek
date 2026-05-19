import type { RelatedVideo } from "@sermon-search/types"
import { render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import { RelatedVideosSlot } from "./related-videos-slot"

vi.mock("next/image", () => ({
  default: ({ src, alt }: { src: string; alt: string }) => <img src={src} alt={alt} />,
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

function makeVideo(overrides: Partial<RelatedVideo> = {}): RelatedVideo {
  return {
    video_id: "yt-abc123",
    title: "Test Sermon",
    thumbnail_url: "https://example.com/thumb.jpg",
    score: 0.9,
    reason: { kind: "same_series", text: "Same series: Romans", playlist_id: "pl-1" },
    ...overrides,
  }
}

describe("RelatedVideosSlot", () => {
  it("renders nothing when related list is empty", () => {
    const { container } = render(<RelatedVideosSlot related={[]} />)
    expect(container.firstChild).toBeNull()
  })

  it("renders the section heading when there are related videos", () => {
    render(<RelatedVideosSlot related={[makeVideo()]} />)
    expect(screen.getByText("Related videos")).toBeInTheDocument()
  })

  it("renders same_series reason line", () => {
    const video = makeVideo({
      reason: { kind: "same_series", text: "Same series: Romans", playlist_id: "pl-1" },
    })
    render(<RelatedVideosSlot related={[video]} />)
    expect(screen.getByText(/Romans/)).toBeInTheDocument()
    expect(screen.getByText(/Series:/)).toBeInTheDocument()
  })

  it("renders chunk_similarity reason line", () => {
    const video = makeVideo({
      reason: {
        kind: "chunk_similarity",
        text: 'Similar passage: "For God so loved the world."',
        matched_chunk_start_ms: 12000,
      },
    })
    render(<RelatedVideosSlot related={[video]} />)
    expect(screen.getByText(/Passage:/)).toBeInTheDocument()
    expect(screen.getByText(/For God so loved/)).toBeInTheDocument()
  })

  it("renders topic_overlap reason line", () => {
    const video = makeVideo({
      reason: {
        kind: "topic_overlap",
        text: "Also about: grace, justification",
        topics: ["grace", "justification"],
      },
    })
    render(<RelatedVideosSlot related={[video]} />)
    expect(screen.getByText(/Topic:/)).toBeInTheDocument()
    expect(screen.getByText(/grace, justification/)).toBeInTheDocument()
  })

  it("renders scripture_overlap reason line", () => {
    const video = makeVideo({
      reason: {
        kind: "scripture_overlap",
        text: "Also references: Rom 8:1-11",
        references: ["Rom 8:1-11"],
      },
    })
    render(<RelatedVideosSlot related={[video]} />)
    expect(screen.getByText(/Scripture:/)).toBeInTheDocument()
    expect(screen.getByText(/Rom 8:1-11/)).toBeInTheDocument()
  })

  it("renders a card for each related video", () => {
    const videos = [
      makeVideo({ video_id: "v1", title: "Sermon One" }),
      makeVideo({ video_id: "v2", title: "Sermon Two" }),
    ]
    render(<RelatedVideosSlot related={videos} />)
    expect(screen.getByText("Sermon One")).toBeInTheDocument()
    expect(screen.getByText("Sermon Two")).toBeInTheDocument()
  })

  it("links each card to the video detail page", () => {
    render(<RelatedVideosSlot related={[makeVideo({ video_id: "yt-xyz" })]} />)
    const link = screen.getByRole("link")
    expect(link).toHaveAttribute("href", "/videos/yt-xyz")
  })
})
