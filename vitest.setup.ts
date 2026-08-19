/**
 * Shared vitest setup for the packages that own integration tests.
 *
 * Those tests gate themselves on TEST_DATABASE_URL and skip when it is unset.
 * Leaving it to each developer to export meant it was usually unset, so whole
 * suites — including the cross-tenant isolation ones — quietly did not run, and
 * real bugs sat behind passing-looking output for months.
 *
 * Default it to the throwaway database that infra/docker-compose.dev.yml serves
 * locally, so `pnpm test` exercises them. An explicit TEST_DATABASE_URL still
 * wins, which is what CI and anything pointing at a different Postgres sets.
 *
 * The tests refuse to run against DATABASE_URL, so this can never truncate a
 * dev database — see the guard in each suite's beforeAll.
 */
const DEFAULT_TEST_DATABASE_URL = "postgres://postgres:postgres@localhost:5432/sermon_search_test"

if (!process.env.TEST_DATABASE_URL) {
  process.env.TEST_DATABASE_URL = DEFAULT_TEST_DATABASE_URL
}
