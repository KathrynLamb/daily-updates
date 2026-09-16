#!/usr/bin/env bash
# scripts/local-db.sh
#
# Creates a fresh local database for trying the app by hand:
# starts PostgreSQL in Docker, applies every migration, and loads the
# demo setting, child and users from db/seed.sql.
#
# Any existing local data is deleted first.

set -euo pipefail

compose_file="compose.local.yml"
service="postgres-local"

printf 'Resetting the local database (existing local data is deleted).\n'

docker compose -f "$compose_file" down --volumes --remove-orphans >/dev/null 2>&1 || true
docker compose -f "$compose_file" up -d --wait

container_id="$(docker compose -f "$compose_file" ps -q "$service")"

run_sql() {
  docker exec -i "$container_id" \
    psql \
    -U daily_updates_local \
    -d daily_updates_local \
    -v ON_ERROR_STOP=1 \
    --single-transaction \
    >/dev/null
}

for migration_path in db/migrations/*.sql; do
  printf 'Applying %s\n' "$migration_path"
  run_sql < "$migration_path"
done

printf 'Loading db/seed.sql\n'
run_sql < db/seed.sql

printf '\nLocal database ready. Next: npm run local:server\n'