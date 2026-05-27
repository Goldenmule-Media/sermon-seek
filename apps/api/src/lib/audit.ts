import type { AdminAuditLogInsert, Database } from "@sermon-search/db"
import type { Kysely } from "kysely"

export async function writeAuditRow(
  db: Kysely<Database>,
  row: AdminAuditLogInsert,
): Promise<void> {
  await db.insertInto("admin_audit_log").values(row).execute()
}
