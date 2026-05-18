import { describe, expect, it } from "vitest"
import { parseArgs } from "./run.js"

describe("parseArgs", () => {
  it("accepts --channel <handle>", () => {
    const parsed = parseArgs(["--channel", "@example"])
    expect(parsed).toEqual({ channel: "@example", video: undefined })
  })

  it("accepts --video <id> with space form", () => {
    const parsed = parseArgs(["--video", "19l5OI_8ljQ"])
    expect(parsed).toEqual({ channel: undefined, video: "19l5OI_8ljQ" })
  })

  it("accepts --video=<id> with equals form", () => {
    const parsed = parseArgs(["--video=19l5OI_8ljQ"])
    expect(parsed).toEqual({ channel: undefined, video: "19l5OI_8ljQ" })
  })

  it("rejects when neither --channel nor --video is set", () => {
    expect(() => parseArgs([])).toThrow(/Missing required/)
  })

  it("rejects when both --channel and --video are set", () => {
    expect(() => parseArgs(["--channel", "@x", "--video", "abc"])).toThrow(/mutually exclusive/)
  })

  it("rejects unknown arguments", () => {
    expect(() => parseArgs(["--frob"])).toThrow(/Unknown argument/)
  })

  it("rejects --video without a value", () => {
    expect(() => parseArgs(["--video"])).toThrow(/requires a value/)
  })
})
