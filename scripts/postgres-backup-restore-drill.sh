#!/usr/bin/env bash
set -euo pipefail

# Safe drill: requires an explicit output directory and never targets the
# compose production database for restore.
OUT_DIR="${1:?usage: $0 <empty-output-directory>}"
if [[ -e "$OUT_DIR" && -n "$(find "$OUT_DIR" -mindepth 1 -maxdepth 1 -print -quit)" ]]; then
  echo "output directory must be empty" >&2
  exit 1
fi
mkdir -p "$OUT_DIR"

PG_SERVICE="${PG_SERVICE:-bottrading-postgres-1}"
PG_USER="${PG_USER:-bottrading}"
PG_DB="${PG_DB:-bottrading}"
BACKUP="$OUT_DIR/bottrading.dump"

docker exec "$PG_SERVICE" pg_dump -U "$PG_USER" -d "$PG_DB" --format=custom --no-owner --file=/tmp/bottrading-drill.dump
docker cp "$PG_SERVICE:/tmp/bottrading-drill.dump" "$BACKUP"
sha256sum "$BACKUP" > "$BACKUP.sha256"

TMP_CONTAINER="bottrading-postgres-restore-drill-$$"
cleanup() { docker rm -f "$TMP_CONTAINER" >/dev/null 2>&1 || true; }
trap cleanup EXIT
docker run --rm -d --name "$TMP_CONTAINER" -e POSTGRES_PASSWORD=drill postgres:16-bookworm >/dev/null
until docker exec "$TMP_CONTAINER" pg_isready -U postgres >/dev/null 2>&1; do sleep 1; done
docker cp "$BACKUP" "$TMP_CONTAINER:/tmp/restore.dump"
docker exec "$TMP_CONTAINER" createdb -U postgres restored
docker exec "$TMP_CONTAINER" pg_restore -U postgres -d restored --no-owner /tmp/restore.dump
docker exec "$TMP_CONTAINER" psql -U postgres -d restored -v ON_ERROR_STOP=1 -Atc \
  "SELECT 'schema=' || count(*) FROM information_schema.tables WHERE table_schema='public';
   SELECT 'orders=' || count(*) FROM \"Order\";
   SELECT 'positions=' || count(*) FROM \"Position\";
   SELECT 'audit_logs=' || count(*) FROM \"AuditLog\";"
echo "backup and isolated restore drill passed: $OUT_DIR"
