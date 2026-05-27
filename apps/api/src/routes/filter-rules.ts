import type { ChannelFilterRuleRow } from "@sermon-search/db"
import type { IngestionFilterRule } from "@sermon-search/types"
import { validatePlaylistTarget } from "@sermon-search/worker"
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod"
import { z } from "zod"
import { auditActor, auditWrite } from "../lib/audit.js"

const channelParams = z.object({
  channelId: z.string().uuid(),
})

const ruleParams = z.object({
  channelId: z.string().uuid(),
  ruleId: z.string().uuid(),
})

const createBody = z.object({
  rule_type: z.enum(["include", "exclude"]),
  target_kind: z.literal("playlist"),
  target_id: z.string().min(1),
  note: z.string().nullish(),
})

const ruleResponse = z.object({
  id: z.string(),
  channel_id: z.string(),
  rule_type: z.enum(["include", "exclude"]),
  target_kind: z.literal("playlist"),
  target_id: z.string(),
  note: z.string().nullable(),
  created_at: z.string(),
})

const createRuleResponse = ruleResponse.extend({ warning: z.string().optional() })

function toDto(row: ChannelFilterRuleRow): IngestionFilterRule {
  return {
    id: row.id,
    channel_id: row.channel_id,
    rule_type: row.rule_type,
    target_kind: row.target_kind,
    target_id: row.target_id,
    note: row.note,
    created_at: (row.created_at as unknown as Date).toISOString(),
  }
}

export const filterRulesRoutes: FastifyPluginAsyncZod = async (app) => {
  app.addHook("preHandler", app.requireAdminOrApiKey)

  app.get(
    "/admin/channels/:channelId/filter-rules",
    {
      schema: {
        tags: ["admin"],
        summary: "List ingestion filter rules for a channel",
        params: channelParams,
        response: {
          200: z.object({ rules: z.array(ruleResponse) }),
          404: z.object({ error: z.string() }),
        },
      },
    },
    async (request, reply) => {
      const { channelId } = request.params

      const channel = await app.db
        .selectFrom("channels")
        .select(["id"])
        .where("id", "=", channelId)
        .executeTakeFirst()

      if (!channel) {
        return reply.code(404).send({ error: `Channel not found: ${channelId}` })
      }

      const rows = await app.db
        .selectFrom("channel_filter_rules")
        .selectAll()
        .where("channel_id", "=", channelId)
        .orderBy("created_at", "asc")
        .execute()

      return reply.send({ rules: rows.map(toDto) })
    },
  )

  app.post(
    "/admin/channels/:channelId/filter-rules",
    {
      schema: {
        tags: ["admin"],
        summary: "Add an ingestion filter rule to a channel",
        params: channelParams,
        body: createBody,
        response: {
          200: createRuleResponse,
          404: z.object({ error: z.string() }),
          409: z.object({ error: z.string() }),
          422: z.object({ error: z.string() }),
        },
      },
    },
    async (request, reply) => {
      const { channelId } = request.params
      const { rule_type, target_kind, target_id, note } = request.body

      const channel = await app.db
        .selectFrom("channels")
        .select(["id", "youtube_channel_id"])
        .where("id", "=", channelId)
        .executeTakeFirst()

      if (!channel) {
        return reply.code(404).send({ error: `Channel not found: ${channelId}` })
      }

      // Validate target_id is a real playlist on this channel
      const validation = await validatePlaylistTarget({
        youtube: app.youtube,
        youtubeChannelId: channel.youtube_channel_id,
        targetId: target_id,
      })
      if (!validation.ok) {
        return reply.code(422).send({ error: validation.message })
      }

      const oppositeType = rule_type === "include" ? "exclude" : "include"
      const conflicting = await app.db
        .selectFrom("channel_filter_rules")
        .select(["id"])
        .where("channel_id", "=", channelId)
        .where("target_kind", "=", target_kind)
        .where("target_id", "=", target_id)
        .where("rule_type", "=", oppositeType)
        .executeTakeFirst()

      try {
        const row = await app.db
          .insertInto("channel_filter_rules")
          .values({
            channel_id: channelId,
            rule_type,
            target_kind,
            target_id,
            note: note ?? null,
          })
          .returningAll()
          .executeTakeFirstOrThrow()

        const dto = toDto(row)
        const { user_id: frUserId, actor: frActor } = auditActor(request)
        await auditWrite(app.db, {
          user_id: frUserId,
          action: "filter_rule.create",
          target_type: "filter_rule",
          target_id: row.id,
          payload: {
            actor: frActor,
            channel_id: channelId,
            rule_type,
            target_kind,
            target_id,
            note: note ?? null,
          },
        })
        if (conflicting) {
          return reply.send({
            ...dto,
            warning: `An ${oppositeType} rule for this playlist already exists; the include rule will win at enforcement time`,
          })
        }
        return reply.send(dto)
      } catch (err) {
        const pgErr = err as { code?: string }
        if (pgErr.code === "23505") {
          return reply.code(409).send({ error: "rule already exists" })
        }
        throw err
      }
    },
  )

  app.delete(
    "/admin/channels/:channelId/filter-rules/:ruleId",
    {
      schema: {
        tags: ["admin"],
        summary: "Delete an ingestion filter rule from a channel",
        params: ruleParams,
        response: {
          200: z.object({ ok: z.literal(true) }),
          404: z.object({ error: z.string() }),
        },
      },
    },
    async (request, reply) => {
      const { channelId, ruleId } = request.params

      const channel = await app.db
        .selectFrom("channels")
        .select(["id"])
        .where("id", "=", channelId)
        .executeTakeFirst()

      if (!channel) {
        return reply.code(404).send({ error: `Channel not found: ${channelId}` })
      }

      const result = await app.db
        .deleteFrom("channel_filter_rules")
        .where("id", "=", ruleId)
        .where("channel_id", "=", channelId)
        .executeTakeFirst()

      if (result.numDeletedRows === 0n) {
        return reply.code(404).send({ error: `Rule not found: ${ruleId}` })
      }

      const { user_id: drUserId, actor: drActor } = auditActor(request)
      await auditWrite(app.db, {
        user_id: drUserId,
        action: "filter_rule.delete",
        target_type: "filter_rule",
        target_id: ruleId,
        payload: { actor: drActor, channel_id: channelId },
      })

      return reply.send({ ok: true as const })
    },
  )
}
