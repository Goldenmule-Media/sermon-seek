<!-- hotseat:HOTSEAT.md version=2 -->
# Hotseat — guidance for AI agents

This repository is managed by [Hotseat](https://hotseat.thegoldenmule.com), an AI-driven task execution system. The notes below describe the tools and conventions available during a coding session.

## hotseat CLI

The `hotseat` CLI is available at `.hotseat/bin/hotseat`. Use it (not the REST API directly) for all board operations.

```bash
.hotseat/bin/hotseat status            # board overview
.hotseat/bin/hotseat card <N>          # card details
.hotseat/bin/hotseat card <N> plan     # card plan text
```

## Wiki tools (MCP — preferred)

Wiki pages are available as first-class MCP tools. Prefer `mcp__hotseat__hotseat_wiki_*` tools over shelling out to the CLI:

- **`hotseat_wiki_search`** — full-text search (`q`, `limit`, `includeArchived`)
- **`hotseat_wiki_read`** — fetch a page (`pageId`; `metadataOnly: true` for cheap revision lookup before mutating)
- **`hotseat_wiki_tree`** — page tree (`showArchived`)
- **`hotseat_wiki_create`** — create a page (`title`, `parentId`, `body`, `linkCardNumber`, `idempotencyKey`)
- **`hotseat_wiki_update`** — update title/body (requires `revision` — read-then-update pattern)
- **`hotseat_wiki_archive`** / **`hotseat_wiki_restore`** — archive/restore (requires `revision`)
- **`hotseat_wiki_link`** / **`hotseat_wiki_unlink`** — page↔card or page↔page links (requires `revision`)
- **`hotseat_wiki_backlinks`** — pages and cards linking to a page
- **`hotseat_wiki_card_pages`** — wiki pages linked to a card (call at session start for design context)
- **`hotseat_wiki_history`** — paginated event stream

**Read-then-update pattern:** mutations require the current `revision`. Call `hotseat_wiki_read` with `metadataOnly: true` to get the revision cheaply, then pass it to `update`/`archive`/`restore`/`link`. On 409 the response contains `{ error: 'concurrency', currentRevision, hint }` — re-read and retry with the new revision.

## Wiki CLI (fallback / shell scripts)

```bash
.hotseat/bin/hotseat wiki search <query>
.hotseat/bin/hotseat wiki read <pageId>
.hotseat/bin/hotseat wiki tree
.hotseat/bin/hotseat wiki create <title> -b <body>
.hotseat/bin/hotseat wiki update <pageId> --revision <n> -b <body>
.hotseat/bin/hotseat wiki card-pages <N>    # wiki pages linked to card N
.hotseat/bin/hotseat wiki link <pageId> --card <N>
```

Run `.hotseat/bin/hotseat wiki --help` for the full reference.

## MCP server

The `.mcp.json` in this repo registers a Hotseat MCP server that Claude Code loads automatically, providing `hotseat_*` tools for card, board, and wiki operations.

## .hotseat/ layout

| Path | Contents |
|------|----------|
| `.hotseat/hotseat.json` | Board config (default board ID, API URL, settings) |
| `.hotseat/bin/hotseat` | Shell wrapper — delegates to the hotseat-cli binary |
| `.hotseat/bin/hotseat-mcp` | Shell wrapper — launches the MCP stdio server |
| `.hotseat/worktrees/` | Per-card git worktrees (gitignored) |

## @HOTSEAT.md reference convention

Other `CLAUDE.md` files in this repo may contain an `@HOTSEAT.md` line. Claude Code expands that reference inline, composing per-project guidance with this Hotseat guidance without duplication.
