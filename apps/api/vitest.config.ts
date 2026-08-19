import { defineConfig } from "vitest/config"

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    // Defaults TEST_DATABASE_URL so the integration suites run instead of
    // silently skipping. Requires the local Postgres to be up:
    //   docker compose -f infra/docker-compose.dev.yml up -d postgres
    setupFiles: ["../../vitest.setup.ts"],
    // Integration tests share a single TEST_DATABASE_URL and TRUNCATE between
    // cases; running test files in parallel causes races and deadlocks. The
    // `test` script also passes --no-file-parallelism; setting it here too
    // means a direct `vitest run` cannot stomp its own rows now that these
    // tests always hit the database.
    fileParallelism: false,
  },
})
