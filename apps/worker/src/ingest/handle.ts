import { YoutubeApiError, type YoutubeClient } from "../youtube/client.js"
import type { YoutubeChannel } from "../youtube/types.js"

const CHANNEL_ID_RE = /^UC[A-Za-z0-9_-]{22}$/

export interface ResolvedChannel {
  youtubeChannelId: string
  title: string
}

export async function resolveChannel(
  client: YoutubeClient,
  handleOrId: string,
): Promise<ResolvedChannel> {
  if (CHANNEL_ID_RE.test(handleOrId)) {
    const response = await client.listChannelsById(handleOrId)
    const channel = response.items?.[0]
    if (!channel) {
      throw new Error(`No channel found with id: ${handleOrId}`)
    }
    return toResolved(channel)
  }

  const bare = handleOrId.startsWith("@") ? handleOrId.slice(1) : handleOrId

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
