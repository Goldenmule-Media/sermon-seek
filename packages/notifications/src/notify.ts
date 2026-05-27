import type { IngestionRequest } from "@sermon-search/types"
import type { EmailSender } from "./sender.js"
import type { NotificationConfig } from "./sender.js"
import { ADMIN_NOTIFY_STATUSES, renderTemplate } from "./templates.js"
import type { TemplateContext, TemplateName } from "./templates.js"

export interface NotifyContext {
  request: IngestionRequest
  webBaseUrl: string
  searchUrl: string
  adminEmail?: string
}

export async function notify(
  sender: EmailSender,
  status: TemplateName,
  ctx: NotifyContext,
  config: NotificationConfig,
): Promise<{ recipients: string[] }> {
  const recipients: string[] = []

  const submitterCtx: TemplateContext = {
    request: ctx.request,
    webBaseUrl: ctx.webBaseUrl,
    searchUrl: ctx.searchUrl,
    audience: "submitter",
  }
  const submitterEmail = renderTemplate(status, submitterCtx)
  await sender.send({
    to: ctx.request.contact_email,
    subject: submitterEmail.subject,
    text: submitterEmail.text,
    html: submitterEmail.html,
  })
  recipients.push(ctx.request.contact_email)

  const adminEmail = ctx.adminEmail ?? config.adminEmail
  if (ADMIN_NOTIFY_STATUSES.has(status) && adminEmail) {
    const adminCtx: TemplateContext = {
      request: ctx.request,
      webBaseUrl: ctx.webBaseUrl,
      searchUrl: ctx.searchUrl,
      audience: "admin",
    }
    const adminEmailContent = renderTemplate(status, adminCtx)
    await sender.send({
      to: adminEmail,
      subject: adminEmailContent.subject,
      text: adminEmailContent.text,
      html: adminEmailContent.html,
    })
    recipients.push(adminEmail)
  }

  return { recipients }
}
