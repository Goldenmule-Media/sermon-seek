import { migrateToLatest } from "../migrate.js"

migrateToLatest().catch((err) => {
  console.error("migration failed:", err)
  process.exit(1)
})
