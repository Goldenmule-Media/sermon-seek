import type { IngestionRequest } from "@sermon-search/types"
import { describe, expect, it } from "vitest"
import { ADMIN_NOTIFY_STATUSES, escapeHtml, renderTemplate } from "./templates.js"
import type { TemplateContext, TemplateName } from "./templates.js"

const WEB_BASE_URL = "http://localhost:3000"
const SEARCH_URL = "http://localhost:3000/mychurch/"

const BASE_REQUEST: IngestionRequest = {
  id: "req-123",
  user_id: "user-456",
  church_id: "church-789",
  requested_slug: "mychurch",
  requested_name: "My Church",
  youtube_handle_or_url: "@mychannel",
  include_playlist_ids: [],
  exclude_playlist_ids: [],
  contact_email: "submitter@example.com",
  status: "received",
  videos_discovered: 42,
  videos_ingested: 17,
  tokens_ingested: 50000,
  limit_reached: false,
  admin_note: null,
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
}

function makeCtx(
  status: TemplateName,
  audience: "submitter" | "admin",
  overrides?: Partial<IngestionRequest>,
): TemplateContext {
  return {
    request: { ...BASE_REQUEST, status, ...overrides },
    webBaseUrl: WEB_BASE_URL,
    searchUrl: SEARCH_URL,
    audience,
  }
}

const DEEP_LINK = `${WEB_BASE_URL}/me/requests/${BASE_REQUEST.id}`
const ADMIN_LINK = `${WEB_BASE_URL}/admin/requests/${BASE_REQUEST.id}`

describe("renderTemplate", () => {
  describe("received", () => {
    it("subject contains slug and status label", () => {
      const { subject } = renderTemplate("received", makeCtx("received", "submitter"))
      expect(subject).toContain("mychurch")
      expect(subject).toContain("received")
    })

    it("submitter text includes deep-link and searchUrl", () => {
      const { text } = renderTemplate("received", makeCtx("received", "submitter"))
      expect(text).toContain(DEEP_LINK)
      expect(text).toContain(SEARCH_URL)
    })

    it("html includes at least one anchor", () => {
      const { html } = renderTemplate("received", makeCtx("received", "submitter"))
      expect(html).toContain("<a href=")
    })
  })

  describe("running", () => {
    it("subject contains slug", () => {
      const { subject } = renderTemplate("running", makeCtx("running", "submitter"))
      expect(subject).toContain("mychurch")
    })

    it("submitter text includes deep-link and searchUrl", () => {
      const { text } = renderTemplate("running", makeCtx("running", "submitter"))
      expect(text).toContain(DEEP_LINK)
      expect(text).toContain(SEARCH_URL)
    })
  })

  describe("awaiting_approval", () => {
    it("submitter subject contains slug", () => {
      const { subject } = renderTemplate(
        "awaiting_approval",
        makeCtx("awaiting_approval", "submitter"),
      )
      expect(subject).toContain("mychurch")
    })

    it("submitter text includes deep-link, searchUrl, and both counters", () => {
      const { text } = renderTemplate(
        "awaiting_approval",
        makeCtx("awaiting_approval", "submitter"),
      )
      expect(text).toContain(DEEP_LINK)
      expect(text).toContain(SEARCH_URL)
      expect(text).toContain("17/42")
      expect(text).toContain("50000")
    })

    it("admin text includes admin request link and counters, not submitter-only wording", () => {
      const { text } = renderTemplate("awaiting_approval", makeCtx("awaiting_approval", "admin"))
      expect(text).toContain(ADMIN_LINK)
      expect(text).toContain("17/42")
      expect(text).toContain("50000")
      expect(text).not.toContain("Your ingestion request")
    })

    it("admin html includes at least one anchor", () => {
      const { html } = renderTemplate("awaiting_approval", makeCtx("awaiting_approval", "admin"))
      expect(html).toContain("<a href=")
    })

    it("is in ADMIN_NOTIFY_STATUSES", () => {
      expect(ADMIN_NOTIFY_STATUSES.has("awaiting_approval")).toBe(true)
    })
  })

  describe("approved", () => {
    it("subject contains slug and 'approved'", () => {
      const { subject } = renderTemplate("approved", makeCtx("approved", "submitter"))
      expect(subject).toContain("mychurch")
      expect(subject).toContain("approved")
    })

    it("submitter text includes deep-link and searchUrl", () => {
      const { text } = renderTemplate("approved", makeCtx("approved", "submitter"))
      expect(text).toContain(DEEP_LINK)
      expect(text).toContain(SEARCH_URL)
    })

    it("submitter html includes at least one anchor", () => {
      const { html } = renderTemplate("approved", makeCtx("approved", "submitter"))
      expect(html).toContain("<a href=")
    })

    it("is not in ADMIN_NOTIFY_STATUSES", () => {
      expect(ADMIN_NOTIFY_STATUSES.has("approved")).toBe(false)
    })
  })

  describe("denied", () => {
    it("submitter text includes deep-link and admin_note when present", () => {
      const { text } = renderTemplate(
        "denied",
        makeCtx("denied", "submitter", { admin_note: "Spam detected" }),
      )
      expect(text).toContain(DEEP_LINK)
      expect(text).toContain("Spam detected")
    })

    it("submitter text omits admin_note line when null", () => {
      const { text } = renderTemplate(
        "denied",
        makeCtx("denied", "submitter", { admin_note: null }),
      )
      expect(text).not.toContain("Admin note")
    })

    it("is not in ADMIN_NOTIFY_STATUSES", () => {
      expect(ADMIN_NOTIFY_STATUSES.has("denied")).toBe(false)
    })
  })

  describe("failed", () => {
    it("submitter text includes deep-link, searchUrl, and admin_note when present", () => {
      const { text } = renderTemplate(
        "failed",
        makeCtx("failed", "submitter", { admin_note: "Worker OOM" }),
      )
      expect(text).toContain(DEEP_LINK)
      expect(text).toContain(SEARCH_URL)
      expect(text).toContain("Worker OOM")
    })

    it("submitter text omits note line when admin_note is null", () => {
      const { text } = renderTemplate(
        "failed",
        makeCtx("failed", "submitter", { admin_note: null }),
      )
      expect(text).not.toContain("Note:")
    })

    it("admin text includes admin request link and admin_note when present", () => {
      const { text } = renderTemplate(
        "failed",
        makeCtx("failed", "admin", { admin_note: "Worker OOM" }),
      )
      expect(text).toContain(ADMIN_LINK)
      expect(text).toContain("Worker OOM")
    })

    it("admin text omits note line when admin_note is null", () => {
      const { text } = renderTemplate("failed", makeCtx("failed", "admin", { admin_note: null }))
      expect(text).not.toContain("Note:")
    })

    it("is in ADMIN_NOTIFY_STATUSES", () => {
      expect(ADMIN_NOTIFY_STATUSES.has("failed")).toBe(true)
    })
  })

  describe("complete", () => {
    it("submitter text includes searchUrl and deep-link", () => {
      const { text } = renderTemplate("complete", makeCtx("complete", "submitter"))
      expect(text).toContain(SEARCH_URL)
      expect(text).toContain(DEEP_LINK)
    })

    it("admin text includes admin request link and searchUrl", () => {
      const { text } = renderTemplate("complete", makeCtx("complete", "admin"))
      expect(text).toContain(ADMIN_LINK)
      expect(text).toContain(SEARCH_URL)
    })

    it("admin text does not contain submitter-only wording", () => {
      const { text } = renderTemplate("complete", makeCtx("complete", "admin"))
      expect(text).not.toContain("Your sermon search")
    })

    it("is in ADMIN_NOTIFY_STATUSES", () => {
      expect(ADMIN_NOTIFY_STATUSES.has("complete")).toBe(true)
    })
  })

  it("throws on unknown template name", () => {
    expect(() =>
      // biome-ignore lint/suspicious/noExplicitAny: testing exhaustiveness guard
      renderTemplate("unknown" as any, makeCtx("received", "submitter")),
    ).toThrow("Unknown template")
  })
})

describe("escapeHtml", () => {
  it("escapes the five special HTML characters", () => {
    expect(escapeHtml('&<>"\'`')).toBe("&amp;&lt;&gt;&quot;&#39;`")
  })

  it("leaves safe text unchanged", () => {
    expect(escapeHtml("Hello, World!")).toBe("Hello, World!")
  })
})

describe("HTML escaping in templates", () => {
  it("escapes requested_name in html but not in text", () => {
    const ctx = makeCtx("received", "submitter", {
      requested_name: '<script>alert("xss")</script>',
    })
    const { html, text } = renderTemplate("received", ctx)
    expect(html).not.toContain("<script>")
    expect(html).toContain("&lt;script&gt;")
    // plain text renders the raw value
    expect(text).toContain('<script>alert("xss")</script>')
  })

  it("escapes admin_note in denied html but not in text", () => {
    const ctx = makeCtx("denied", "submitter", {
      admin_note: '<b>bad</b> & "worse"',
    })
    const { html, text } = renderTemplate("denied", ctx)
    expect(html).not.toContain("<b>")
    expect(html).toContain("&lt;b&gt;bad&lt;/b&gt; &amp; &quot;worse&quot;")
    expect(text).toContain('<b>bad</b> & "worse"')
  })

  it("escapes admin_note in failed html (submitter audience)", () => {
    const ctx = makeCtx("failed", "submitter", { admin_note: "<em>oops</em>" })
    const { html } = renderTemplate("failed", ctx)
    expect(html).not.toContain("<em>oops</em>")
    expect(html).toContain("&lt;em&gt;oops&lt;/em&gt;")
  })

  it("escapes admin_note in failed html (admin audience)", () => {
    const ctx = makeCtx("failed", "admin", { admin_note: "<em>oops</em>" })
    const { html } = renderTemplate("failed", ctx)
    expect(html).not.toContain("<em>oops</em>")
    expect(html).toContain("&lt;em&gt;oops&lt;/em&gt;")
  })

  it("escapes ampersands in requested_name", () => {
    const ctx = makeCtx("approved", "submitter", { requested_name: "Faith & Hope Church" })
    const { html, text } = renderTemplate("approved", ctx)
    expect(html).toContain("Faith &amp; Hope Church")
    expect(text).toContain("Faith & Hope Church")
  })
})
