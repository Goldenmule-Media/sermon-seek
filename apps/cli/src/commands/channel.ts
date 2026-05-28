import { Command } from "commander"
import { printChannel, printJson, printRefresh, printViewStats } from "../output.js"
import { run } from "./_util.js"

export function makeChannelCommand(): Command {
  const cmd = new Command("channel").description("Channel ingestion operations")

  cmd
    .command("add")
    .description("Register a YouTube channel for a church")
    .requiredOption("--church-slug <slug>", "Church slug")
    .option(
      "--handle <handle>",
      "YouTube channel handle (provide exactly one of --handle or --youtube-channel-id)",
    )
    .option("--youtube-channel-id <id>", "YouTube channel ID")
    .action(
      async (opts: { churchSlug: string; handle?: string; youtubeChannelId?: string }, self) => {
        if (!opts.handle && !opts.youtubeChannelId) {
          console.error("Provide exactly one of --handle or --youtube-channel-id.")
          process.exit(1)
        }
        if (opts.handle && opts.youtubeChannelId) {
          console.error("Provide exactly one of --handle or --youtube-channel-id, not both.")
          process.exit(1)
        }
        await run(self, async (client, json) => {
          const data = await client.channelAdd({
            churchSlug: opts.churchSlug,
            handle: opts.handle,
            youtubeChannelId: opts.youtubeChannelId,
          })
          if (json) printJson(data)
          else printChannel(data)
        })
      },
    )

  cmd
    .command("refresh")
    .description("Refresh channel/playlist/video metadata for a church")
    .requiredOption("--church-slug <slug>", "Church slug")
    .option("--channel <handleOrId>", "Refresh only this channel (handle or ID)")
    .option("--force", "Force re-ingest even if recently ingested")
    .action(async (opts: { churchSlug: string; channel?: string; force?: boolean }, self) => {
      await run(self, async (client, json) => {
        const data = await client.channelRefresh({
          churchSlug: opts.churchSlug,
          channel: opts.channel,
          force: opts.force,
        })
        if (json) printJson(data)
        else printRefresh(data)
      })
    })

  cmd
    .command("view-stats")
    .description("Update playlist view statistics for a church")
    .requiredOption("--church-slug <slug>", "Church slug")
    .action(async (opts: { churchSlug: string }, self) => {
      await run(self, async (client, json) => {
        const data = await client.channelViewStats(opts.churchSlug)
        if (json) printJson(data)
        else printViewStats(data)
      })
    })

  return cmd
}
