import { describe, expect, it } from "vitest"
import { RESERVED_SLUGS, validateSlug } from "./slug.js"

describe("validateSlug — format", () => {
  it("accepts 1-char slug", () => {
    expect(validateSlug("a")).toEqual({ ok: true })
  })

  it("accepts 2-char slug", () => {
    expect(validateSlug("ab")).toEqual({ ok: true })
    expect(validateSlug("a1")).toEqual({ ok: true })
  })

  it("accepts 63-char slug", () => {
    // 'a' + 61 interior chars + 'z' = 63
    expect(validateSlug(`a${"b".repeat(61)}z`)).toEqual({ ok: true })
  })

  it("accepts 64-char slug (max)", () => {
    // 'a' + 62 interior chars + 'z' = 64
    expect(validateSlug(`a${"b".repeat(62)}z`)).toEqual({ ok: true })
  })

  it("rejects 65-char slug (over max)", () => {
    expect(validateSlug(`a${"b".repeat(63)}z`)).toEqual({
      ok: false,
      reason: "format",
    })
  })

  it("rejects empty string", () => {
    expect(validateSlug("")).toEqual({ ok: false, reason: "format" })
  })

  it("rejects leading dash", () => {
    expect(validateSlug("-abc")).toEqual({ ok: false, reason: "format" })
  })

  it("rejects trailing dash", () => {
    expect(validateSlug("abc-")).toEqual({ ok: false, reason: "format" })
  })

  it("rejects uppercase", () => {
    expect(validateSlug("Abc")).toEqual({ ok: false, reason: "format" })
    expect(validateSlug("ABC")).toEqual({ ok: false, reason: "format" })
  })

  it("rejects underscore", () => {
    expect(validateSlug("a_b")).toEqual({ ok: false, reason: "format" })
  })

  it("accepts interior dash", () => {
    expect(validateSlug("abc-def")).toEqual({ ok: true })
  })
})

describe("validateSlug — reserved words", () => {
  for (const word of RESERVED_SLUGS) {
    it(`rejects reserved slug "${word}" with reason 'reserved'`, () => {
      expect(validateSlug(word)).toEqual({ ok: false, reason: "reserved" })
    })
  }

  it("accepts a clearly valid non-reserved slug", () => {
    expect(validateSlug("mychurch")).toEqual({ ok: true })
  })
})
