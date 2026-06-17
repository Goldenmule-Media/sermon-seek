import type { Database } from "@sermon-search/db"
import type { Kysely } from "kysely"
import { afterEach, describe, expect, it, vi } from "vitest"
import type { YoutubeClient } from "../youtube/client.js"
import { parseVideoIds, pollRssForNewUploads } from "./rss.js"

vi.mock("./transcript.js", () => ({
  ingestVideoTranscript: vi.fn().mockResolvedValue({
    status: "ok",
    videoDbId: "v1",
    transcriptId: "t1",
    segmentCount: 10,
    wordCount: 100,
  }),
}))

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
    const xml = "<feed><yt:videoId>short</yt:videoId><yt:videoId>aB3cD4eF5gH</yt:videoId></feed>"
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

describe("pollRssForNewUploads", () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it("returns seen/newIds/ingested counts when some ids are already known", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        statusText: "OK",
        text: vi.fn().mockResolvedValue(FEED_FIXTURE),
      }),
    )

    const execute = vi.fn().mockResolvedValue([{ youtube_video_id: "iJ6kL7mN8oP" }])
    const where = vi.fn().mockReturnValue({ execute })
    const select = vi.fn().mockReturnValue({ where })
    const db = {
      selectFrom: vi.fn().mockReturnValue({ select }),
    } as unknown as Kysely<Database>

    const client = {} as unknown as YoutubeClient

    const result = await pollRssForNewUploads({
      youtubeChannelId: "UC_test",
      churchId: "church_test",
      db,
      client,
    })

    expect(result).toEqual({ seen: 3, newIds: 2, ingested: 2 })
  })
})
