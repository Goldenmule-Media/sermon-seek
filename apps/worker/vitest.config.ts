import { defineConfig } from "vitest/config"

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    // Integration tests share a single TEST_DATABASE_URL and TRUNCATE between
    // cases; running test files in parallel causes races and deadlocks.
    fileParallelism: false,
  },
})
