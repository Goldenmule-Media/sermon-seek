import { createDb } from "@sermon-search/db"
import type { Database } from "@sermon-search/db"
import type { Kysely } from "kysely"

const USERS_USAGE = `usage: worker:run users <subcommand> <google_sub>

Subcommands:
  promote <google_sub>   Set is_admin = true for the matching user
  demote  <google_sub>   Set is_admin = false for the matching user`

type UsersSubcommand =
  | { subcommand: "promote"; googleSub: string }
  | { subcommand: "demote"; googleSub: string }
  | { subcommand: "help" }

export function parseUsersArgs(argv: readonly string[]): UsersSubcommand {
  if (argv.length === 0 || argv[0] === "--help" || argv[0] === "-h") {
    return { subcommand: "help" }
  }

  const sub = argv[0]
  const rest = argv.slice(1)

  if (sub !== "promote" && sub !== "demote") {
    throw new Error(`Unknown users subcommand: ${sub}`)
  }

  if (rest.length === 0) {
    throw new Error(`<google_sub> is required for users ${sub}`)
  }
  if (rest.length > 1) {
    throw new Error(`Too many arguments for users ${sub}: ${rest.slice(1).join(", ")}`)
  }

  return { subcommand: sub, googleSub: rest[0] as string }
}

export interface UsersDeps {
  db?: Kysely<Database>
}

export async function runUsersCli(argv: readonly string[], deps: UsersDeps = {}): Promise<number> {
  let parsed: UsersSubcommand
  try {
    parsed = parseUsersArgs(argv)
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err))
    console.error(USERS_USAGE)
    return 2
  }

  if (parsed.subcommand === "help") {
    console.log(USERS_USAGE)
    return 0
  }

  const db = deps.db ?? createDb()
  const ownDb = !deps.db

  try {
    const isAdmin = parsed.subcommand === "promote"
    const row = await db
      .updateTable("users")
      .set({ is_admin: isAdmin })
      .where("google_sub", "=", parsed.googleSub)
      .returning(["id", "google_sub", "is_admin"])
      .executeTakeFirst()

    if (!row) {
      console.error(`user not found: ${parsed.googleSub}`)
      return 1
    }

    console.log(
      JSON.stringify(
        { ok: true, id: row.id, google_sub: row.google_sub, is_admin: row.is_admin },
        null,
        2,
      ),
    )
    return 0
  } catch (err) {
    console.error(err instanceof Error ? (err.stack ?? err.message) : String(err))
    return 1
  } finally {
    if (ownDb) await db.destroy()
  }
}
