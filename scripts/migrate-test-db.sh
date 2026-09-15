#!/usr/bin/env bash

set -euo pipefail

test_database_url="${TEST_DATABASE_URL:-postgresql://daily_updates_test:daily_updates_test@127.0.0.1:55432/daily_updates_test}"

for migration_path in db/migrations/*.sql; do
  printf 'Applying %s\n' "$migration_path"

  psql "$test_database_url" \
    -v ON_ERROR_STOP=1 \
    --single-transaction \
    -f "$migration_path" \
    >/dev/null
done

printf 'Test database migrations complete.\n'