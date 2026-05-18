export { fetchCaptions } from "./fetch.js"
export type {
  FetchCaptionsOptions,
  FetchCaptionsResult,
  SpawnResult,
  Spawner,
} from "./fetch.js"
export { parseVtt, parseTimestamp } from "./parse.js"
export type { Segment, Word } from "./parse.js"
export {
  CaptionError,
  CaptionsUnavailable,
  VttParseError,
  YtDlpFailed,
} from "./errors.js"
export type { CaptionErrorCode } from "./errors.js"
export { YT_DLP_VERSION } from "./version.js"
