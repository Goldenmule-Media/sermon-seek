import { describe, expect, it } from "vitest"
import { parseUsersArgs } from "./users.js"

describe("parseUsersArgs", () => {
  describe("help", () => {
    it("returns help when no args", () => {
      expect(parseUsersArgs([])).toEqual({ subcommand: "help" })
    })

    it("returns help for --help", () => {
      expect(parseUsersArgs(["--help"])).toEqual({ subcommand: "help" })
    })

    it("returns help for -h", () => {
      expect(parseUsersArgs(["-h"])).toEqual({ subcommand: "help" })
    })
  })

  describe("promote", () => {
    it("accepts promote <google_sub>", () => {
      expect(parseUsersArgs(["promote", "1234567890"])).toEqual({
        subcommand: "promote",
        googleSub: "1234567890",
      })
    })

    it("rejects promote without google_sub", () => {
      expect(() => parseUsersArgs(["promote"])).toThrow(/<google_sub> is required/)
    })

    it("rejects promote with extra positional args", () => {
      expect(() => parseUsersArgs(["promote", "sub1", "sub2"])).toThrow(/Too many arguments/)
    })
  })

  describe("demote", () => {
    it("accepts demote <google_sub>", () => {
      expect(parseUsersArgs(["demote", "1234567890"])).toEqual({
        subcommand: "demote",
        googleSub: "1234567890",
      })
    })

    it("rejects demote without google_sub", () => {
      expect(() => parseUsersArgs(["demote"])).toThrow(/<google_sub> is required/)
    })

    it("rejects demote with extra positional args", () => {
      expect(() => parseUsersArgs(["demote", "sub1", "extra"])).toThrow(/Too many arguments/)
    })
  })

  describe("unknown subcommand", () => {
    it("rejects unknown subcommands", () => {
      expect(() => parseUsersArgs(["list"])).toThrow(/Unknown users subcommand/)
    })

    it("rejects unknown subcommands with args (unknown takes precedence over too-many)", () => {
      expect(() => parseUsersArgs(["unknown-sub", "x"])).toThrow(/Unknown users subcommand/)
    })
  })
})
