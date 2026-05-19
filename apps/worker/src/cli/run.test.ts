import { describe, expect, it, vi } from "vitest"
import { parseArgs } from "./run.js"

vi.mock("openai", () => ({ default: vi.fn() }))

describe("parseArgs", () => {
  it("accepts --channel <handle>", () => {
    const parsed = parseArgs(["--channel", "@example"])
    expect(parsed).toEqual({
      channel: "@example",
      video: undefined,
      smokeTest: false,
      viewStats: false,
      embed: false,
      enrich: false,
      related: false,
      force: false,
    })
  })

  it("accepts --video <id> with space form", () => {
    const parsed = parseArgs(["--video", "19l5OI_8ljQ"])
    expect(parsed).toEqual({
      channel: undefined,
      video: "19l5OI_8ljQ",
      smokeTest: false,
      viewStats: false,
      embed: false,
      enrich: false,
      related: false,
      force: false,
    })
  })

  it("accepts --video=<id> with equals form", () => {
    const parsed = parseArgs(["--video=19l5OI_8ljQ"])
    expect(parsed).toEqual({
      channel: undefined,
      video: "19l5OI_8ljQ",
      smokeTest: false,
      viewStats: false,
      embed: false,
      enrich: false,
      related: false,
      force: false,
    })
  })

  it("accepts --smoke-test alone", () => {
    const parsed = parseArgs(["--smoke-test"])
    expect(parsed).toEqual({
      channel: undefined,
      video: undefined,
      smokeTest: true,
      viewStats: false,
      embed: false,
      enrich: false,
      related: false,
      force: false,
    })
  })

  it("accepts --view-stats alone", () => {
    const parsed = parseArgs(["--view-stats"])
    expect(parsed).toEqual({
      channel: undefined,
      video: undefined,
      smokeTest: false,
      viewStats: true,
      embed: false,
      enrich: false,
      related: false,
      force: false,
    })
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

  it("rejects when --view-stats is combined with --channel", () => {
    expect(() => parseArgs(["--view-stats", "--channel", "@x"])).toThrow(/mutually exclusive/)
  })

  it("rejects when --view-stats is combined with --video", () => {
    expect(() => parseArgs(["--view-stats", "--video", "abc"])).toThrow(/mutually exclusive/)
  })

  it("rejects --view-stats combined with --smoke-test", () => {
    expect(() => parseArgs(["--view-stats", "--smoke-test"])).toThrow(/mutually exclusive/)
  })

  it("rejects unknown arguments", () => {
    expect(() => parseArgs(["--frob"])).toThrow(/Unknown argument/)
  })

  it("rejects --video without a value", () => {
    expect(() => parseArgs(["--video"])).toThrow(/requires a value/)
  })

  it("accepts --embed alone", () => {
    const parsed = parseArgs(["--embed"])
    expect(parsed).toEqual({
      channel: undefined,
      video: undefined,
      smokeTest: false,
      viewStats: false,
      embed: true,
      enrich: false,
      related: false,
      force: false,
    })
  })

  it("rejects --embed combined with --channel", () => {
    expect(() => parseArgs(["--embed", "--channel", "@x"])).toThrow(/mutually exclusive/)
  })

  it("rejects --embed combined with --video", () => {
    expect(() => parseArgs(["--embed", "--video", "abc"])).toThrow(/mutually exclusive/)
  })

  it("rejects --embed combined with --smoke-test", () => {
    expect(() => parseArgs(["--embed", "--smoke-test"])).toThrow(/mutually exclusive/)
  })

  it("rejects --embed=value (boolean flag form only)", () => {
    expect(() => parseArgs(["--embed=anything"])).toThrow(/does not take a value/)
  })

  it("accepts --enrich alone", () => {
    const parsed = parseArgs(["--enrich"])
    expect(parsed).toEqual({
      channel: undefined,
      video: undefined,
      smokeTest: false,
      viewStats: false,
      embed: false,
      enrich: true,
      related: false,
      force: false,
    })
  })

  it("accepts --enrich --force", () => {
    const parsed = parseArgs(["--enrich", "--force"])
    expect(parsed).toEqual({
      channel: undefined,
      video: undefined,
      smokeTest: false,
      viewStats: false,
      embed: false,
      enrich: true,
      related: false,
      force: true,
    })
  })

  it("rejects --force without --enrich or --related", () => {
    expect(() => parseArgs(["--force"])).toThrow(/--force requires --enrich or --related/)
  })

  it("accepts --related alone", () => {
    const parsed = parseArgs(["--related"])
    expect(parsed).toEqual({
      channel: undefined,
      video: undefined,
      smokeTest: false,
      viewStats: false,
      embed: false,
      enrich: false,
      related: true,
      force: false,
    })
  })

  it("accepts --related --force", () => {
    const parsed = parseArgs(["--related", "--force"])
    expect(parsed).toEqual({
      channel: undefined,
      video: undefined,
      smokeTest: false,
      viewStats: false,
      embed: false,
      enrich: false,
      related: true,
      force: true,
    })
  })

  it("rejects --related combined with --enrich", () => {
    expect(() => parseArgs(["--related", "--enrich"])).toThrow(/mutually exclusive/)
  })

  it("rejects --related combined with --embed", () => {
    expect(() => parseArgs(["--related", "--embed"])).toThrow(/mutually exclusive/)
  })

  it("rejects --related combined with --channel", () => {
    expect(() => parseArgs(["--related", "--channel", "@x"])).toThrow(/mutually exclusive/)
  })

  it("rejects --related combined with --video", () => {
    expect(() => parseArgs(["--related", "--video", "abc"])).toThrow(/mutually exclusive/)
  })

  it("rejects --related=value (boolean flag form only)", () => {
    expect(() => parseArgs(["--related=anything"])).toThrow(/does not take a value/)
  })

  it("rejects --enrich combined with --embed", () => {
    expect(() => parseArgs(["--enrich", "--embed"])).toThrow(/mutually exclusive/)
  })

  it("rejects --enrich combined with --channel", () => {
    expect(() => parseArgs(["--enrich", "--channel", "@x"])).toThrow(/mutually exclusive/)
  })

  it("rejects --enrich=value (boolean flag form only)", () => {
    expect(() => parseArgs(["--enrich=anything"])).toThrow(/does not take a value/)
  })
})
