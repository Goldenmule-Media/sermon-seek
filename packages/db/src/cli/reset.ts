import pg from "pg"
import { resolveDatabaseUrl } from "../index.js"
import { migrateToLatest } from "../migrate.js"

async function reset(): Promise<void> {
  const url = new URL(resolveDatabaseUrl())
  const targetDb = url.pathname.replace(/^\//, "")
  if (!targetDb) {
    throw new Error(`DATABASE_URL has no database name: ${url.toString()}`)
  }

  const adminUrl = new URL(url.toString())
  adminUrl.pathname = "/postgres"

  const client = new pg.Client({ connectionString: adminUrl.toString() })
  await client.connect()
  try {
    await client.query(
      `SELECT pg_terminate_backend(pid)
         FROM pg_stat_activity
        WHERE datname = $1 AND pid <> pg_backend_pid()`,
      [targetDb],
    )
    await client.query(`DROP DATABASE IF EXISTS "${targetDb}"`)
    await client.query(`CREATE DATABASE "${targetDb}"`)
  } finally {
    await client.end()
  }

  console.log(`database "${targetDb}" dropped and recreated`)
  await migrateToLatest()
}

reset().catch((err) => {
  console.error("reset failed:", err)
  process.exit(1)
})
