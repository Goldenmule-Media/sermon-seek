import { promises as fs } from "node:fs"
import * as path from "node:path"
import { fileURLToPath } from "node:url"
import { FileMigrationProvider, Migrator } from "kysely"
import { createDb, resolveDatabaseUrl } from "./index.js"

const here = path.dirname(fileURLToPath(import.meta.url))
const migrationFolder = path.resolve(here, "migrations")

export async function migrateToLatest(connectionString?: string): Promise<void> {
  const db = createDb(resolveDatabaseUrl(connectionString))
  const migrator = new Migrator({
    db,
    provider: new FileMigrationProvider({
      fs,
      path,
      migrationFolder,
    }),
  })

  try {
    const { error, results } = await migrator.migrateToLatest()

    for (const it of results ?? []) {
      if (it.status === "Success") {
        console.log(`migration "${it.migrationName}" applied`)
      } else if (it.status === "Error") {
        console.error(`migration "${it.migrationName}" failed`)
      }
    }

    if (error) {
      throw error instanceof Error ? error : new Error(String(error))
    }
  } finally {
    await db.destroy()
  }
}
