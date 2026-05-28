import { YoutubeApiError, type YoutubeClient } from "../youtube/client.js"
import type { YoutubeChannel } from "../youtube/types.js"

const CHANNEL_ID_RE = /^UC[A-Za-z0-9_-]{22}$/

export interface ResolvedChannel {
  youtubeChannelId: string
  title: string
}

/**
 * Accepts bare handles (`@foo`, `foo`), channel IDs (`UC…`), and the YouTube
 * URL forms the ingest form's hint advertises (`https://youtube.com/@foo`,
 * `/channel/UC…`, `/c/foo`, `/user/foo`). Returns a string suitable for the
 * resolution branches below; falls back to the trimmed input when the URL
 * shape isn't recognised so the caller still emits `unknown_handle`.
 */
export function normalizeHandleInput(input: string): string {
  const trimmed = input.trim()
  if (!/^https?:\/\//i.test(trimmed)) return trimmed

  let url: URL
  try {
    url = new URL(trimmed)
  } catch {
    return trimmed
  }

  const host = url.hostname.toLowerCase().replace(/^www\./, "")
  if (host !== "youtube.com" && host !== "m.youtube.com" && host !== "youtu.be") {
    return trimmed
  }

  const segments = url.pathname.split("/").filter(Boolean)
  const first = segments[0] ?? ""

  if (first.startsWith("@")) return first
  const kind = first.toLowerCase()
  if ((kind === "channel" || kind === "c" || kind === "user") && segments[1]) {
    return segments[1]
  }
  return trimmed
}

export async function resolveChannel(
  client: YoutubeClient,
  handleOrId: string,
): Promise<ResolvedChannel> {
  const normalized = normalizeHandleInput(handleOrId)

  if (CHANNEL_ID_RE.test(normalized)) {
    const response = await client.listChannelsById(normalized)
    const channel = response.items?.[0]
    if (!channel) {
      throw new Error(`No channel found with id: ${normalized}`)
    }
    return toResolved(channel)
  }

  const bare = normalized.startsWith("@") ? normalized.slice(1) : normalized

  const byHandle = await client.listChannelsByHandle(`@${bare}`)
  const handleChannel = byHandle.items?.[0]
  if (handleChannel) {
    return toResolved(handleChannel)
  }

  try {
    const byUsername = await client.listChannelsByUsername(bare)
    const usernameChannel = byUsername.items?.[0]
    if (usernameChannel) {
      return toResolved(usernameChannel)
    }
  } catch (err) {
    if (!(err instanceof YoutubeApiError)) throw err
  }

  throw new Error(`No channel found for handle: ${handleOrId}`)
}

function toResolved(channel: YoutubeChannel): ResolvedChannel {
  const title = channel.snippet?.title
  if (!title) {
    throw new Error(`Channel ${channel.id} is missing snippet.title`)
  }
  return { youtubeChannelId: channel.id, title }
}
