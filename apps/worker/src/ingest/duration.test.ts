import { describe, expect, it } from "vitest"
import { iso8601DurationToSeconds } from "./duration.js"

describe("iso8601DurationToSeconds", () => {
  it("parses H/M/S", () => {
    expect(iso8601DurationToSeconds("PT1H2M3S")).toBe(3723)
  })
  it("parses minutes only", () => {
    expect(iso8601DurationToSeconds("PT45M")).toBe(45 * 60)
  })
  it("parses seconds only", () => {
    expect(iso8601DurationToSeconds("PT15S")).toBe(15)
  })
  it("parses zero duration", () => {
    expect(iso8601DurationToSeconds("PT0S")).toBe(0)
  })
  it("parses days only", () => {
    expect(iso8601DurationToSeconds("P1D")).toBe(86400)
  })
  it("parses days + time", () => {
    expect(iso8601DurationToSeconds("P1DT2H")).toBe(86400 + 7200)
  })
  it("throws on garbage", () => {
    expect(() => iso8601DurationToSeconds("notaduration")).toThrow()
  })
})
