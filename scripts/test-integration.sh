#!/usr/bin/env bash

set -euo pipefail

compose_file="compose.test.yml"
test_database_url="postgresql://daily_updates_test:daily_updates_test@127.0.0.1:55432/daily_updates_test"

cleanup() {
  test_exit_code=$?

  trap - EXIT

  if [[ $test_exit_code -ne 0 ]]; then
    docker compose \
      -f "$compose_file" \
      logs \
      --no-color
  fi

  docker compose \
    -f "$compose_file" \
    down \
    --volumes \
    --remove-orphans \
    >/dev/null 2>&1 || true

  exit "$test_exit_code"
}

trap cleanup EXIT

# Always begin with a completely fresh disposable database.
docker compose \
  -f "$compose_file" \
  down \
  --volumes \
  --remove-orphans \
  >/dev/null 2>&1 || true

docker compose \
  -f "$compose_file" \
  up \
  -d \
  --wait

TEST_DATABASE_URL="$test_database_url" \
  ./scripts/migrate-test-db.sh

DATABASE_URL="$test_database_url" \
ANTHROPIC_API_KEY="integration-test-placeholder" \
  ./node_modules/.bin/tsx \
  --test \
  test/integration/*.test.ts