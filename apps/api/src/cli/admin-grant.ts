import { createDb } from "@sermon-search/db"
import { auditWrite } from "../lib/audit.js"

const email = process.argv[2]?.trim().toLowerCase()

if (!email) {
  console.error("Usage: pnpm admin:grant <email>")
  process.exit(1)
}

const databaseUrl = process.env.DATABASE_URL
if (!databaseUrl) {
  console.error("DATABASE_URL is required")
  process.exit(1)
}

const db = createDb(databaseUrl)

try {
  // The users table deliberately does not store email.
  // Resolve users.id via the most recent ingestion_requests row matching contact_email.
  const row = await db
    .selectFrom("ingestion_requests")
    .innerJoin("users", "users.id", "ingestion_requests.user_id")
    .select(["users.id as userId", "users.is_admin"])
    .where(db.fn("lower", ["ingestion_requests.contact_email"]), "=", email)
    .orderBy("ingestion_requests.created_at", "desc")
    .limit(1)
    .executeTakeFirst()

  if (!row) {
    console.error(
      `No ingestion request found with contact_email "${email}". If this user has never submitted a request, add the email to ADMIN_ALLOWED_EMAILS and have them sign in once via Google.`,
    )
    process.exit(1)
  }

  if (row.is_admin) {
    console.log(`User ${row.userId} is already an admin.`)
    process.exit(0)
  }

  await db.updateTable("users").set({ is_admin: true }).where("id", "=", row.userId).execute()

  await auditWrite(db, {
    user_id: null,
    action: "admin.grant",
    target_type: "user",
    target_id: row.userId,
    payload: { actor: "cli", email },
  })

  console.log(`Granted admin to user ${row.userId} (email: ${email})`)
} finally {
  await db.destroy()
}
