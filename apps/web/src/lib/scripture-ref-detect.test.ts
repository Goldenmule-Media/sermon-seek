import { describe, expect, it } from "vitest"
import { isRefLike } from "./scripture-ref-detect"

describe("isRefLike", () => {
  it("returns true for a plain book+chapter ref", () => {
    expect(isRefLike("Romans 8")).toBe(true)
  })

  it("returns true for abbreviated book+chapter:verse", () => {
    expect(isRefLike("Rom 8:3")).toBe(true)
  })

  it("returns true for numbered book prefix", () => {
    expect(isRefLike("1 Corinthians 13")).toBe(true)
  })

  it("returns true for written-out numbered prefix", () => {
    expect(isRefLike("First Corinthians 13:4-7")).toBe(true)
  })

  it("returns true for lowercase ASR-style space-separated ref", () => {
    expect(isRefLike("john 3 16")).toBe(true)
  })

  it("returns true for chapter:verse range", () => {
    expect(isRefLike("Romans 8:1-5")).toBe(true)
  })

  it("returns false for a single non-ref word", () => {
    expect(isRefLike("grace")).toBe(false)
  })

  it("returns false for a multi-word topic phrase", () => {
    expect(isRefLike("forgiveness")).toBe(false)
  })

  it("returns false for a bare book name with no chapter", () => {
    expect(isRefLike("Romans")).toBe(false)
  })

  it("returns false for 'chapter N' (non-book word before digit)", () => {
    expect(isRefLike("chapter 8")).toBe(false)
  })

  it("returns false for empty string", () => {
    expect(isRefLike("")).toBe(false)
  })

  it("returns false for whitespace-only string", () => {
    expect(isRefLike("   ")).toBe(false)
  })
})
