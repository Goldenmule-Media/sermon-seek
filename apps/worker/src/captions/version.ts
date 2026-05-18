// Canonical pin for the yt-dlp version used by the caption fetcher. Keep in
// sync with the literal `yt-dlp==<version>` line in apps/worker/Dockerfile —
// the Docker build cannot import TypeScript, so the coupling is enforced by
// review. The value is also written into `transcripts.model_version` as part
// of the (video_id, source, model_version) idempotency key, so bumping it
// naturally triggers a fresh transcript row.
export const YT_DLP_VERSION = "2025.01.26"
