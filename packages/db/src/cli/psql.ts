import { spawn } from "node:child_process"
import { promises as fs } from "node:fs"
import * as path from "node:path"

async function findRepoRoot(start: string): Promise<string> {
  let dir = start
  while (true) {
    try {
      await fs.access(path.join(dir, "pnpm-workspace.yaml"))
      return dir
    } catch {
      const parent = path.dirname(dir)
      if (parent === dir) {
        throw new Error("could not locate repo root (pnpm-workspace.yaml not found)")
      }
      dir = parent
    }
  }
}

async function main(): Promise<void> {
  const repoRoot = await findRepoRoot(process.cwd())
  const composeFile = path.join(repoRoot, "infra", "docker-compose.dev.yml")
  const extraArgs = process.argv.slice(2)
  const args = [
    "compose",
    "-f",
    composeFile,
    "exec",
    "postgres",
    "psql",
    "-U",
    "postgres",
    "-d",
    "sermon_search",
    ...extraArgs,
  ]

  const child = spawn("docker", args, { stdio: "inherit" })
  child.on("exit", (code) => {
    process.exit(code ?? 0)
  })
}

main().catch((err) => {
  console.error("psql failed:", err)
  process.exit(1)
})
