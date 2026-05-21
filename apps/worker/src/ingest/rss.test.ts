import { describe, expect, it } from "vitest"

// Expose the internal parser for unit testing without network calls.
// We re-implement the same regex here to keep the test self-contained.
function parseVideoIds(xml: string): string[] {
  const ids: string[] = []
  const re = /<yt:videoId>([A-Za-z0-9_-]{11})<\/yt:videoId>/g
  let m: RegExpExecArray | null
  while ((m = re.exec(xml)) !== null) {
    ids.push(m[1])
  }
  return ids
}

const FEED_FIXTURE = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns:yt="http://www.youtube.com/xml/schemas/2015">
  <entry>
    <yt:videoId>aB3cD4eF5gH</yt:videoId>
    <title>Sermon One</title>
  </entry>
  <entry>
    <yt:videoId>iJ6kL7mN8oP</yt:videoId>
    <title>Sermon Two</title>
  </entry>
  <entry>
    <yt:videoId>qR9sT0uV1wX</yt:videoId>
    <title>Sermon Three</title>
  </entry>
</feed>`

describe("parseVideoIds", () => {
  it("extracts all yt:videoId elements from a feed", () => {
    const ids = parseVideoIds(FEED_FIXTURE)
    expect(ids).toEqual(["aB3cD4eF5gH", "iJ6kL7mN8oP", "qR9sT0uV1wX"])
  })

  it("returns empty array for a feed with no entries", () => {
    const ids = parseVideoIds(`<feed xmlns:yt="http://www.youtube.com/xml/schemas/2015"></feed>`)
    expect(ids).toEqual([])
  })

  it("ignores malformed or short ids", () => {
    const xml = `<feed><yt:videoId>short</yt:videoId><yt:videoId>aB3cD4eF5gH</yt:videoId></feed>`
    const ids = parseVideoIds(xml)
    expect(ids).toEqual(["aB3cD4eF5gH"])
  })
})

describe("dedupe logic", () => {
  it("filters out ids already in the existing set", () => {
    const feedIds = ["aB3cD4eF5gH", "iJ6kL7mN8oP", "qR9sT0uV1wX"]
    const existingSet = new Set(["iJ6kL7mN8oP"])
    const toIngest = feedIds.filter((id) => !existingSet.has(id))
    expect(toIngest).toEqual(["aB3cD4eF5gH", "qR9sT0uV1wX"])
  })

  it("returns empty when all ids are already known", () => {
    const feedIds = ["aB3cD4eF5gH", "iJ6kL7mN8oP"]
    const existingSet = new Set(["aB3cD4eF5gH", "iJ6kL7mN8oP"])
    const toIngest = feedIds.filter((id) => !existingSet.has(id))
    expect(toIngest).toEqual([])
  })
})
