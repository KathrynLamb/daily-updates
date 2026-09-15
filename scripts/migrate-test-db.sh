#!/usr/bin/env bash

set -euo pipefail

compose_file="${TEST_COMPOSE_FILE:-compose.test.yml}"

test_container_id="$(
  docker compose \
    -f "$compose_file" \
    ps \
    -q \
    postgres-test
)"

if [[ -z "$test_container_id" ]]; then
  printf 'The disposable PostgreSQL container is not running.\n' >&2
  exit 1
fi

for migration_path in db/migrations/*.sql; do
  printf 'Applying %s\n' "$migration_path"

  docker exec \
    -i \
    "$test_container_id" \
    psql \
    -U daily_updates_test \
    -d daily_updates_test \
    -v ON_ERROR_STOP=1 \
    --single-transaction \
    < "$migration_path" \
    >/dev/null
done

printf 'Test database migrations complete.\n'