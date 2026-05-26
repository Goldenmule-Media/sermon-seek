import type { IngestionRequest } from "@sermon-search/types"
import { describe, expect, it, vi } from "vitest"
import { notify } from "./notify.js"
import type { EmailMessage, EmailSender, NotificationConfig } from "./sender.js"
import type { TemplateName } from "./templates.js"

function makeStubSender(): EmailSender & { calls: EmailMessage[] } {
  const calls: EmailMessage[] = []
  return {
    calls,
    async send(msg: EmailMessage): Promise<void> {
      calls.push(msg)
    },
  }
}

const BASE_REQUEST: IngestionRequest = {
  id: "req-abc",
  user_id: "user-1",
  church_id: null,
  requested_slug: "testchurch",
  requested_name: "Test Church",
  youtube_handle_or_url: "@test",
  include_playlist_ids: [],
  exclude_playlist_ids: [],
  contact_email: "submitter@example.com",
  status: "received",
  videos_discovered: 10,
  videos_ingested: 10,
  tokens_ingested: 1000,
  limit_reached: false,
  admin_note: null,
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
}

const BASE_CONFIG: NotificationConfig = {
  from: "noreply@example.com",
  adminEmail: "admin@example.com",
}

const BASE_CTX = {
  request: BASE_REQUEST,
  webBaseUrl: "http://localhost:3000",
  searchUrl: "http://localhost:3000/testchurch/",
}

describe("notify", () => {
  it.each(["received", "running", "denied"] as TemplateName[])(
    "%s sends exactly one email to the submitter",
    async (status) => {
      const sender = makeStubSender()
      const { recipients } = await notify(sender, status, BASE_CTX, BASE_CONFIG)
      expect(sender.calls).toHaveLength(1)
      expect(sender.calls[0]?.to).toBe("submitter@example.com")
      expect(recipients).toEqual(["submitter@example.com"])
    },
  )

  it.each(["awaiting_approval", "failed", "complete"] as TemplateName[])(
    "%s sends submitter email first, then admin email",
    async (status) => {
      const sender = makeStubSender()
      const { recipients } = await notify(sender, status, BASE_CTX, BASE_CONFIG)
      expect(sender.calls).toHaveLength(2)
      expect(sender.calls[0]?.to).toBe("submitter@example.com")
      expect(sender.calls[1]?.to).toBe("admin@example.com")
      expect(recipients).toEqual(["submitter@example.com", "admin@example.com"])
    },
  )

  it("sends only to submitter when adminEmail is unset and status is admin-notifying", async () => {
    const sender = makeStubSender()
    const config: NotificationConfig = { from: "noreply@example.com" }
    const { recipients } = await notify(sender, "complete", BASE_CTX, config)
    expect(sender.calls).toHaveLength(1)
    expect(recipients).toEqual(["submitter@example.com"])
  })

  it("ctx.adminEmail overrides config.adminEmail", async () => {
    const sender = makeStubSender()
    const ctx = { ...BASE_CTX, adminEmail: "override-admin@example.com" }
    await notify(sender, "complete", ctx, BASE_CONFIG)
    expect(sender.calls[1]?.to).toBe("override-admin@example.com")
  })

  it("does not throw when adminEmail is absent for non-admin-notifying statuses", async () => {
    const sender = makeStubSender()
    const config: NotificationConfig = { from: "noreply@example.com" }
    await expect(notify(sender, "received", BASE_CTX, config)).resolves.toBeDefined()
  })
})
