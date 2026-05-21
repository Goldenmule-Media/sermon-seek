import { describe, expect, it } from "vitest"
import { parseFiltersArgs } from "./filters.js"

describe("parseFiltersArgs", () => {
  describe("help", () => {
    it("returns help when no args", () => {
      expect(parseFiltersArgs([])).toEqual({ subcommand: "help" })
    })

    it("returns help for --help", () => {
      expect(parseFiltersArgs(["--help"])).toEqual({ subcommand: "help" })
    })

    it("returns help for -h", () => {
      expect(parseFiltersArgs(["-h"])).toEqual({ subcommand: "help" })
    })
  })

  describe("list", () => {
    it("accepts list --channel <handle>", () => {
      expect(parseFiltersArgs(["list", "--channel", "@example"])).toEqual({
        subcommand: "list",
        channel: "@example",
      })
    })

    it("accepts list --channel <uuid>", () => {
      const uuid = "11111111-2222-3333-4444-555555555555"
      expect(parseFiltersArgs(["list", "--channel", uuid])).toEqual({
        subcommand: "list",
        channel: uuid,
      })
    })

    it("accepts list --channel=<handle> (equals form)", () => {
      expect(parseFiltersArgs(["list", "--channel=@example"])).toEqual({
        subcommand: "list",
        channel: "@example",
      })
    })

    it("rejects list without --channel", () => {
      expect(() => parseFiltersArgs(["list"])).toThrow(/--channel is required/)
    })

    it("rejects list --channel without a value", () => {
      expect(() => parseFiltersArgs(["list", "--channel"])).toThrow(/requires a value/)
    })

    it("rejects unknown args in list", () => {
      expect(() => parseFiltersArgs(["list", "--channel", "@x", "--unknown"])).toThrow(
        /Unknown argument/,
      )
    })
  })

  describe("add", () => {
    it("accepts add with --include", () => {
      expect(
        parseFiltersArgs(["add", "--channel", "@example", "--include", "--playlist", "PLabc123"]),
      ).toEqual({
        subcommand: "add",
        channel: "@example",
        ruleType: "include",
        playlist: "PLabc123",
        note: undefined,
      })
    })

    it("accepts add with --exclude", () => {
      expect(
        parseFiltersArgs(["add", "--channel", "@example", "--exclude", "--playlist", "PLabc123"]),
      ).toEqual({
        subcommand: "add",
        channel: "@example",
        ruleType: "exclude",
        playlist: "PLabc123",
        note: undefined,
      })
    })

    it("accepts add with --note", () => {
      expect(
        parseFiltersArgs([
          "add",
          "--channel",
          "@example",
          "--include",
          "--playlist",
          "PLabc123",
          "--note",
          "some note",
        ]),
      ).toEqual({
        subcommand: "add",
        channel: "@example",
        ruleType: "include",
        playlist: "PLabc123",
        note: "some note",
      })
    })

    it("accepts add with --note=<value> (equals form)", () => {
      const result = parseFiltersArgs([
        "add",
        "--channel",
        "@example",
        "--include",
        "--playlist",
        "PLabc123",
        "--note=my note",
      ])
      expect(result).toMatchObject({ note: "my note" })
    })

    it("accepts add with UUID channel", () => {
      const uuid = "11111111-2222-3333-4444-555555555555"
      expect(
        parseFiltersArgs(["add", "--channel", uuid, "--include", "--playlist", "PLabc123"]),
      ).toEqual({
        subcommand: "add",
        channel: uuid,
        ruleType: "include",
        playlist: "PLabc123",
        note: undefined,
      })
    })

    it("accepts add --channel=<value> (equals form)", () => {
      const result = parseFiltersArgs([
        "add",
        "--channel=@example",
        "--include",
        "--playlist",
        "PLabc123",
      ])
      expect(result).toMatchObject({ channel: "@example" })
    })

    it("accepts add --playlist=<value> (equals form)", () => {
      const result = parseFiltersArgs([
        "add",
        "--channel",
        "@example",
        "--include",
        "--playlist=PLabc123",
      ])
      expect(result).toMatchObject({ playlist: "PLabc123" })
    })

    it("rejects add with both --include and --exclude", () => {
      expect(() =>
        parseFiltersArgs([
          "add",
          "--channel",
          "@example",
          "--include",
          "--exclude",
          "--playlist",
          "PLabc123",
        ]),
      ).toThrow(/mutually exclusive/)
    })

    it("rejects add without --include or --exclude", () => {
      expect(() =>
        parseFiltersArgs(["add", "--channel", "@example", "--playlist", "PLabc123"]),
      ).toThrow(/--include or --exclude is required/)
    })

    it("rejects add without --channel", () => {
      expect(() => parseFiltersArgs(["add", "--include", "--playlist", "PLabc123"])).toThrow(
        /--channel is required/,
      )
    })

    it("rejects add without --playlist", () => {
      expect(() => parseFiltersArgs(["add", "--channel", "@example", "--include"])).toThrow(
        /--playlist is required/,
      )
    })

    it("rejects add --channel without a value", () => {
      expect(() => parseFiltersArgs(["add", "--channel"])).toThrow(/requires a value/)
    })

    it("rejects unknown args in add", () => {
      expect(() =>
        parseFiltersArgs(["add", "--channel", "@x", "--include", "--playlist", "PLabc", "--bogus"]),
      ).toThrow(/Unknown argument/)
    })
  })

  describe("remove", () => {
    it("accepts remove --rule-id <uuid>", () => {
      const uuid = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"
      expect(parseFiltersArgs(["remove", "--rule-id", uuid])).toEqual({
        subcommand: "remove",
        ruleId: uuid,
      })
    })

    it("accepts remove --rule-id=<uuid> (equals form)", () => {
      const uuid = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"
      expect(parseFiltersArgs(["remove", `--rule-id=${uuid}`])).toEqual({
        subcommand: "remove",
        ruleId: uuid,
      })
    })

    it("rejects remove without --rule-id", () => {
      expect(() => parseFiltersArgs(["remove"])).toThrow(/--rule-id is required/)
    })

    it("rejects remove --rule-id without a value", () => {
      expect(() => parseFiltersArgs(["remove", "--rule-id"])).toThrow(/requires a value/)
    })

    it("rejects unknown args in remove", () => {
      expect(() => parseFiltersArgs(["remove", "--rule-id", "abc", "--extra"])).toThrow(
        /Unknown argument/,
      )
    })
  })

  describe("unknown subcommand", () => {
    it("rejects unknown subcommands", () => {
      expect(() => parseFiltersArgs(["bogus"])).toThrow(/Unknown filters subcommand/)
    })
  })
})
