export type CaptionErrorCode = "captions_unavailable" | "yt_dlp_failed" | "vtt_parse_error"

export class CaptionError extends Error {
  readonly code: CaptionErrorCode

  constructor(code: CaptionErrorCode, message: string, options?: { cause?: unknown }) {
    super(message, options as ErrorOptions | undefined)
    this.code = code
    this.name = "CaptionError"
  }
}

export class CaptionsUnavailable extends CaptionError {
  readonly videoId: string

  constructor(videoId: string, message?: string) {
    super("captions_unavailable", message ?? `No English auto-captions available for ${videoId}`)
    this.name = "CaptionsUnavailable"
    this.videoId = videoId
  }
}

export class YtDlpFailed extends CaptionError {
  readonly exitCode: number | null
  readonly stderrTail: string

  constructor(exitCode: number | null, stderrTail: string, options?: { cause?: unknown }) {
    super(
      "yt_dlp_failed",
      `yt-dlp exited with code ${exitCode ?? "null"}: ${stderrTail.trim() || "<no stderr>"}`,
      options,
    )
    this.name = "YtDlpFailed"
    this.exitCode = exitCode
    this.stderrTail = stderrTail
  }
}

export class VttParseError extends CaptionError {
  constructor(message: string, options?: { cause?: unknown }) {
    super("vtt_parse_error", message, options)
    this.name = "VttParseError"
  }
}
