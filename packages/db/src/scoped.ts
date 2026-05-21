import type {
  DeleteQueryBuilder,
  DeleteResult,
  InsertQueryBuilder,
  InsertResult,
  Kysely,
  SelectQueryBuilder,
  UpdateQueryBuilder,
  UpdateResult,
} from "kysely"
import type { Database } from "./index.js"

export const TENANT_TABLES = new Set<string>([
  "channels",
  "playlists",
  "videos",
  "transcript_chunks",
  "embeddings",
  "topics",
  "videos_with_transcripts",
])

export type TenantTable =
  | "channels"
  | "playlists"
  | "videos"
  | "transcript_chunks"
  | "embeddings"
  | "topics"
  | "videos_with_transcripts"

export function assertChurchId(value: unknown): asserts value is string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error("ScopedDb requires a non-empty churchId")
  }
}

function parseTableRef(ref: string): { table: string; alias: string } {
  const match = ref.match(/^(\S+)\s+as\s+(\S+)$/i)
  if (match?.[1] && match[2]) {
    return { table: match[1], alias: match[2] }
  }
  return { table: ref, alias: ref }
}

/**
 * The only legitimate way to query tenant-bearing tables. Wraps a Kysely
 * instance and auto-applies a church_id filter to every tenant-scoped query.
 * The type-level + runtime guard pair prevents both TS-escape-hatch leaks and
 * accidental unscoped access.
 */
export class ScopedDb {
  readonly #db: Kysely<Database>
  readonly #churchId: string

  constructor(db: Kysely<Database>, churchId: string) {
    assertChurchId(churchId)
    this.#db = db
    this.#churchId = churchId
  }

  get churchId(): string {
    return this.#churchId
  }

  selectFrom<TB extends keyof Database & string>(
    ref: TB,
  ): SelectQueryBuilder<Database, TB, {}>
  selectFrom<TB extends keyof Database & string>(
    ref: `${TB} as ${string}`,
  ): SelectQueryBuilder<Database, TB, {}>
  selectFrom(ref: string): SelectQueryBuilder<Database, keyof Database & string, {}> {
    const { table, alias } = parseTableRef(ref)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const qb = this.#db.selectFrom(ref as any)
    if (TENANT_TABLES.has(table)) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return (qb as any).where(`${alias}.church_id`, "=", this.#churchId)
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return qb as any
  }

  updateTable<TB extends keyof Database & string>(
    ref: TB,
  ): UpdateQueryBuilder<Database, TB, TB, UpdateResult>
  updateTable<TB extends keyof Database & string>(
    ref: `${TB} as ${string}`,
  ): UpdateQueryBuilder<Database, TB, TB, UpdateResult>
  updateTable(
    ref: string,
  ): UpdateQueryBuilder<Database, keyof Database & string, keyof Database & string, UpdateResult> {
    const { table, alias } = parseTableRef(ref)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const qb = this.#db.updateTable(ref as any)
    if (TENANT_TABLES.has(table)) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return (qb as any).where(`${alias}.church_id`, "=", this.#churchId)
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return qb as any
  }

  deleteFrom<TB extends keyof Database & string>(
    ref: TB,
  ): DeleteQueryBuilder<Database, TB, DeleteResult>
  deleteFrom<TB extends keyof Database & string>(
    ref: `${TB} as ${string}`,
  ): DeleteQueryBuilder<Database, TB, DeleteResult>
  deleteFrom(
    ref: string,
  ): DeleteQueryBuilder<Database, keyof Database & string, DeleteResult> {
    const { table, alias } = parseTableRef(ref)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const qb = this.#db.deleteFrom(ref as any)
    if (TENANT_TABLES.has(table)) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return (qb as any).where(`${alias}.church_id`, "=", this.#churchId)
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return qb as any
  }

  insertInto<TB extends keyof Database & string>(
    table: TB,
  ): InsertQueryBuilder<Database, TB, InsertResult> {
    const inner = this.#db.insertInto(table)
    if (!TENANT_TABLES.has(table)) {
      return inner
    }
    const churchId = this.#churchId
    return new Proxy(inner, {
      get(target, prop, receiver) {
        if (prop === "values") {
          return function (insert: unknown) {
            if (typeof insert === "function") {
              throw new Error(
                "ScopedDb: callback-style inserts are not supported for tenant tables",
              )
            }
            const items = Array.isArray(insert) ? insert : [insert]
            const merged = items.map((row: Record<string, unknown>) => {
              if ("church_id" in row && row.church_id !== churchId) {
                throw new Error(
                  "ScopedDb: cannot insert with a conflicting church_id",
                )
              }
              return { ...row, church_id: churchId }
            })
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            return (target as any).values(Array.isArray(insert) ? merged : merged[0])
          }
        }
        const val = Reflect.get(target, prop, receiver)
        return typeof val === "function" ? val.bind(target) : val
      },
    }) as unknown as InsertQueryBuilder<Database, TB, InsertResult>
  }
}

export function createScopedDb(db: Kysely<Database>, churchId: string): ScopedDb {
  return new ScopedDb(db, churchId)
}
