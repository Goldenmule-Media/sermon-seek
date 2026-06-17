import type { IngestionRequest } from "@sermon-search/types"

export function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
}

export type TemplateName =
  | "received"
  | "running"
  | "awaiting_approval"
  | "approved"
  | "denied"
  | "failed"
  | "complete"

export interface TemplateContext {
  request: IngestionRequest
  webBaseUrl: string
  searchUrl: string
  audience: "submitter" | "admin"
}

export interface RenderedEmail {
  subject: string
  text: string
  html: string
}

export const ADMIN_NOTIFY_STATUSES: ReadonlySet<TemplateName> = new Set([
  "awaiting_approval",
  "failed",
  "complete",
])

function requestDeepLink(ctx: TemplateContext): string {
  return `${ctx.webBaseUrl}/me/requests/${ctx.request.id}`
}

function adminRequestLink(ctx: TemplateContext): string {
  return `${ctx.webBaseUrl}/admin/requests/${ctx.request.id}`
}

function wrapHtml(subject: string, body: string): string {
  return `<!DOCTYPE html><html><body><h2>${subject}</h2>${body}</body></html>`
}

function link(text: string, href: string): string {
  return `<a href="${escapeHtml(href)}">${escapeHtml(text)}</a>`
}

export function renderTemplate(name: TemplateName, ctx: TemplateContext): RenderedEmail {
  const { request, searchUrl, audience } = ctx
  const slug = request.requested_slug
  const deepLink = requestDeepLink(ctx)
  // Escaped versions for use inside HTML bodies only. Plain-text uses the originals
  // (intentional — text/plain doesn't need entity escaping; do not reuse in any future text/html fallback).
  const safeName = escapeHtml(request.requested_name)
  const safeSlug = escapeHtml(slug)
  const safeAdminNote = request.admin_note ? escapeHtml(request.admin_note) : null

  switch (name) {
    case "received": {
      const subject = `[sermon-search] received – ${slug}`
      const text = [
        `We've received your ingestion request for "${request.requested_name}" (${slug}).`,
        "",
        `Track your request status: ${deepLink}`,
        `Your search will eventually live at: ${searchUrl}`,
      ].join("\n")
      const html = wrapHtml(
        subject,
        `<p>We've received your ingestion request for <strong>${safeName}</strong> (${safeSlug}).</p>` +
          `<p>Track your request: ${link(deepLink, deepLink)}</p>` +
          `<p>Your search will eventually live at: ${link(searchUrl, searchUrl)}</p>`,
      )
      return { subject, text, html }
    }

    case "running": {
      const subject = `[sermon-search] indexing started – ${slug}`
      const text = [
        `Indexing has started for "${request.requested_name}" (${slug}).`,
        "",
        `Track your request status: ${deepLink}`,
        `Your search will eventually live at: ${searchUrl}`,
      ].join("\n")
      const html = wrapHtml(
        subject,
        `<p>Indexing has started for <strong>${safeName}</strong> (${safeSlug}).</p>` +
          `<p>Track your request: ${link(deepLink, deepLink)}</p>` +
          `<p>Your search will eventually live at: ${link(searchUrl, searchUrl)}</p>`,
      )
      return { subject, text, html }
    }

    case "awaiting_approval": {
      const subject = `[sermon-search] awaiting approval – ${slug}`
      const counters = `${request.videos_ingested}/${request.videos_discovered} videos indexed, ${request.tokens_ingested} tokens ingested`

      if (audience === "admin") {
        const adminLink = adminRequestLink(ctx)
        const text = [
          `Ingestion request "${request.requested_name}" (${slug}) has hit the token cap and needs your approval.`,
          "",
          `${counters}`,
          "",
          `Review and approve or deny: ${adminLink}`,
          `Submitter request page: ${deepLink}`,
        ].join("\n")
        const html = wrapHtml(
          subject,
          `<p>Ingestion request <strong>${safeName}</strong> (${safeSlug}) has hit the token cap and needs your approval.</p>` +
            `<p>${counters}</p>` +
            `<p>Review: ${link(adminLink, adminLink)}</p>` +
            `<p>Submitter page: ${link(deepLink, deepLink)}</p>`,
        )
        return { subject, text, html }
      }

      const text = [
        `Your ingestion request for "${request.requested_name}" (${slug}) is awaiting admin approval.`,
        "",
        `${counters}`,
        "",
        `Track your request status: ${deepLink}`,
        `Your search will eventually live at: ${searchUrl}`,
      ].join("\n")
      const html = wrapHtml(
        subject,
        `<p>Your ingestion request for <strong>${safeName}</strong> (${safeSlug}) is awaiting admin approval.</p>` +
          `<p>${counters}</p>` +
          `<p>Track your request: ${link(deepLink, deepLink)}</p>` +
          `<p>Your search will eventually live at: ${link(searchUrl, searchUrl)}</p>`,
      )
      return { subject, text, html }
    }

    case "approved": {
      const subject = `[sermon-search] approved – ${slug}`
      const text = [
        `Great news! Your ingestion request for "${request.requested_name}" (${slug}) has been approved.`,
        "",
        "Indexing will resume shortly and your full sermon library will be indexed.",
        "",
        `Track your request status: ${deepLink}`,
        `Your search will live at: ${searchUrl}`,
      ].join("\n")
      const html = wrapHtml(
        subject,
        `<p>Great news! Your ingestion request for <strong>${safeName}</strong> (${safeSlug}) has been approved.</p><p>Indexing will resume shortly and your full sermon library will be indexed.</p><p>Track your request: ${link(deepLink, deepLink)}</p><p>Your search will live at: ${link(searchUrl, searchUrl)}</p>`,
      )
      return { subject, text, html }
    }

    case "denied": {
      const subject = `[sermon-search] denied – ${slug}`
      const noteLines = request.admin_note ? ["", `Admin note: ${request.admin_note}`] : []
      const text = [
        `Your ingestion request for "${request.requested_name}" (${slug}) was denied.`,
        ...noteLines,
        "",
        `Track your request status: ${deepLink}`,
      ].join("\n")
      const noteHtml = safeAdminNote ? `<p><em>Admin note: ${safeAdminNote}</em></p>` : ""
      const html = wrapHtml(
        subject,
        `<p>Your ingestion request for <strong>${safeName}</strong> (${safeSlug}) was denied.</p>${noteHtml}<p>Track your request: ${link(deepLink, deepLink)}</p>`,
      )
      return { subject, text, html }
    }

    case "failed": {
      const subject = `[sermon-search] failed – ${slug}`
      const noteLines = request.admin_note ? ["", `Note: ${request.admin_note}`] : []

      if (audience === "admin") {
        const adminLink = adminRequestLink(ctx)
        const text = [
          `Ingestion request "${request.requested_name}" (${slug}) has failed.`,
          ...noteLines,
          "",
          `Review: ${adminLink}`,
          `Submitter request page: ${deepLink}`,
        ].join("\n")
        const noteHtml = safeAdminNote ? `<p><em>Note: ${safeAdminNote}</em></p>` : ""
        const html = wrapHtml(
          subject,
          `<p>Ingestion request <strong>${safeName}</strong> (${safeSlug}) has failed.</p>${noteHtml}<p>Review: ${link(adminLink, adminLink)}</p><p>Submitter page: ${link(deepLink, deepLink)}</p>`,
        )
        return { subject, text, html }
      }

      const text = [
        `Your ingestion request for "${request.requested_name}" (${slug}) has failed.`,
        ...noteLines,
        "",
        `Track your request status: ${deepLink}`,
        `Your search will eventually live at: ${searchUrl}`,
      ].join("\n")
      const noteHtml = safeAdminNote ? `<p><em>Note: ${safeAdminNote}</em></p>` : ""
      const html = wrapHtml(
        subject,
        `<p>Your ingestion request for <strong>${safeName}</strong> (${safeSlug}) has failed.</p>${noteHtml}<p>Track your request: ${link(deepLink, deepLink)}</p><p>Your search will eventually live at: ${link(searchUrl, searchUrl)}</p>`,
      )
      return { subject, text, html }
    }

    case "complete": {
      const subject = `[sermon-search] complete – ${slug}`

      if (audience === "admin") {
        const adminLink = adminRequestLink(ctx)
        const text = [
          `Ingestion request "${request.requested_name}" (${slug}) is complete.`,
          "",
          `${request.videos_ingested}/${request.videos_discovered} videos indexed.`,
          "",
          `Review: ${adminLink}`,
          `Live search: ${searchUrl}`,
        ].join("\n")
        const html = wrapHtml(
          subject,
          `<p>Ingestion request <strong>${safeName}</strong> (${safeSlug}) is complete.</p>` +
            `<p>${request.videos_ingested}/${request.videos_discovered} videos indexed.</p>` +
            `<p>Review: ${link(adminLink, adminLink)}</p>` +
            `<p>Live search: ${link(searchUrl, searchUrl)}</p>`,
        )
        return { subject, text, html }
      }

      const text = [
        `Your sermon search for "${request.requested_name}" is live!`,
        "",
        `Search now: ${searchUrl}`,
        "",
        `Track your request: ${deepLink}`,
      ].join("\n")
      const html = wrapHtml(
        subject,
        `<p>Your sermon search for <strong>${safeName}</strong> is live!</p>` +
          `<p>${link("Search now", searchUrl)}: ${link(searchUrl, searchUrl)}</p>` +
          `<p>Track your request: ${link(deepLink, deepLink)}</p>`,
      )
      return { subject, text, html }
    }

    default: {
      const _exhaustive: never = name
      throw new Error(`Unknown template: ${_exhaustive}`)
    }
  }
}
