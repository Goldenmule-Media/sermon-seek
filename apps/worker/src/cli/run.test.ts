import { describe, expect, it } from "vitest"
import { parseArgs } from "./run.js"

describe("parseArgs", () => {
  it("accepts --channel <handle>", () => {
    const parsed = parseArgs(["--channel", "@example"])
    expect(parsed).toEqual({ channel: "@example", video: undefined, smokeTest: false })
  })

  it("accepts --video <id> with space form", () => {
    const parsed = parseArgs(["--video", "19l5OI_8ljQ"])
    expect(parsed).toEqual({ channel: undefined, video: "19l5OI_8ljQ", smokeTest: false })
  })

  it("accepts --video=<id> with equals form", () => {
    const parsed = parseArgs(["--video=19l5OI_8ljQ"])
    expect(parsed).toEqual({ channel: undefined, video: "19l5OI_8ljQ", smokeTest: false })
  })

  it("accepts --smoke-test alone", () => {
    const parsed = parseArgs(["--smoke-test"])
    expect(parsed).toEqual({ channel: undefined, video: undefined, smokeTest: true })
  })

  it("rejects --smoke-test combined with --video", () => {
    expect(() => parseArgs(["--smoke-test", "--video", "abc"])).toThrow(/mutually exclusive/)
  })

  it("rejects --smoke-test combined with --channel", () => {
    expect(() => parseArgs(["--smoke-test", "--channel", "@x"])).toThrow(/mutually exclusive/)
  })

  it("rejects --smoke-test=value (boolean flag form only)", () => {
    expect(() => parseArgs(["--smoke-test=anything"])).toThrow(/does not take a value/)
  })

  it("rejects when no mode flag is set", () => {
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
