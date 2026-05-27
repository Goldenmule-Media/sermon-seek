import type { AdminAuditLogInsert, Database } from "@sermon-search/db"
import type { FastifyRequest } from "fastify"
import type { Kysely } from "kysely"

// No admin request bodies contain secrets today; revisit if that changes.

export async function auditWrite(db: Kysely<Database>, row: AdminAuditLogInsert): Promise<void> {
  await db.insertInto("admin_audit_log").values(row).execute()
}

export function auditActor(request: FastifyRequest): {
  user_id: string | null
  actor: "session" | "cli"
} {
  if (request.user?.id) {
    return { user_id: request.user.id, actor: "session" }
  }
  return { user_id: null, actor: "cli" }
}
