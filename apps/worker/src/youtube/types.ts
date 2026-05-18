export interface YoutubeThumbnail {
  url: string
  width?: number
  height?: number
}

export interface YoutubeThumbnails {
  default?: YoutubeThumbnail
  medium?: YoutubeThumbnail
  high?: YoutubeThumbnail
  standard?: YoutubeThumbnail
  maxres?: YoutubeThumbnail
}

export interface YoutubeChannel {
  id: string
  snippet?: {
    title?: string
    description?: string
    publishedAt?: string
  }
}

export interface YoutubePlaylist {
  id: string
  snippet?: {
    channelId?: string
    title?: string
    description?: string
    publishedAt?: string
    thumbnails?: YoutubeThumbnails
  }
  contentDetails?: {
    itemCount?: number
  }
}

export interface YoutubePlaylistItem {
  id: string
  snippet?: {
    publishedAt?: string
    channelId?: string
    title?: string
    description?: string
    thumbnails?: YoutubeThumbnails
    playlistId?: string
    position?: number
    resourceId?: {
      kind?: string
      videoId?: string
    }
    videoOwnerChannelId?: string
  }
  contentDetails?: {
    videoId?: string
    videoPublishedAt?: string
  }
}

export interface YoutubeVideo {
  id: string
  snippet?: {
    publishedAt?: string
    channelId?: string
    title?: string
    description?: string
    thumbnails?: YoutubeThumbnails
  }
  contentDetails?: {
    duration?: string
  }
  statistics?: {
    viewCount?: string
  }
}

export interface ListResponse<T> {
  kind?: string
  etag?: string
  nextPageToken?: string
  prevPageToken?: string
  pageInfo?: { totalResults?: number; resultsPerPage?: number }
  items?: T[]
}

export type ChannelsListResponse = ListResponse<YoutubeChannel>
export type PlaylistsListResponse = ListResponse<YoutubePlaylist>
export type PlaylistItemsListResponse = ListResponse<YoutubePlaylistItem>
export type VideosListResponse = ListResponse<YoutubeVideo>

export function pickThumbnailUrl(thumbnails: YoutubeThumbnails | undefined): string | null {
  if (!thumbnails) return null
  return (
    thumbnails.maxres?.url ??
    thumbnails.standard?.url ??
    thumbnails.high?.url ??
    thumbnails.medium?.url ??
    thumbnails.default?.url ??
    null
  )
}
