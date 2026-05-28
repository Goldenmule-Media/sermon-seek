import { Command } from "commander"
import { printChurchDetail, printChurchList, printChurchVideos, printJson } from "../output.js"
import { run } from "./_util.js"

export function makeChurchesCommand(): Command {
  const cmd = new Command("churches").description("Church management")

  cmd
    .command("list")
    .description("List all churches")
    .option("--slug-prefix <prefix>", "Filter by slug prefix")
    .option("--limit <n>", "Max results (default 20)", (v) => Number.parseInt(v, 10))
    .option("--offset <n>", "Offset for pagination", (v) => Number.parseInt(v, 10))
    .action(async (opts: { slugPrefix?: string; limit?: number; offset?: number }, self) => {
      await run(self, async (client, json) => {
        const data = await client.churchesList({
          slug_prefix: opts.slugPrefix,
          limit: opts.limit,
          offset: opts.offset,
        })
        if (json) printJson(data)
        else printChurchList(data)
      })
    })

  cmd
    .command("get <id>")
    .description("Get church detail by ID")
    .action(async (id: string, _opts, self) => {
      await run(self, async (client, json) => {
        const data = await client.churchGet(id)
        if (json) printJson(data)
        else printChurchDetail(data)
      })
    })

  cmd
    .command("videos <id>")
    .description("List videos for a church")
    .option("--limit <n>", "Max results (default 50)", (v) => Number.parseInt(v, 10))
    .option("--offset <n>", "Offset for pagination", (v) => Number.parseInt(v, 10))
    .option("--has-transcript", "Only videos with a transcript")
    .option("--no-transcript", "Only videos without a transcript")
    .action(
      async (
        id: string,
        opts: { limit?: number; offset?: number; hasTranscript?: boolean; transcript?: boolean },
        self,
      ) => {
        await run(self, async (client, json) => {
          const has_transcript =
            opts.hasTranscript === true ? true : opts.transcript === false ? false : undefined
          const data = await client.churchVideos(id, {
            limit: opts.limit,
            offset: opts.offset,
            has_transcript,
          })
          if (json) printJson(data)
          else printChurchVideos(data)
        })
      },
    )

  return cmd
}
