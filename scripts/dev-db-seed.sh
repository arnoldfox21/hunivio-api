#!/usr/bin/env bash
# Salin data DB local (Postgres.app, keyloka_db) ke DB dev di VPS.
# Pakai:  VPS=user@host VPS_DIR=/opt/keyloka-api-dev bash scripts/dev-db-seed.sh
# Peringatan: MENIMPA isi DB dev. Dump berisi data user nyata (jika local pernah ditarik dari prod) -> jangan di-commit.
set -euo pipefail
: "${VPS:?set VPS=user@host}"; : "${VPS_DIR:?set VPS_DIR=/path/keyloka-api-dev}"
PG_BIN="${PG_BIN:-/Applications/Postgres.app/Contents/Versions/16/bin}"
DUMP="$(mktemp -t keyloka_dev_XXXX).dump"

"$PG_BIN/pg_dump" -h 127.0.0.1 -U postgres -d keyloka_db -Fc --no-owner --no-privileges -f "$DUMP"
scp "$DUMP" "$VPS:/tmp/keyloka_dev.dump"
ssh "$VPS" "cd $VPS_DIR && set -a && . ./.env.dev && set +a && \
  docker compose -f docker-compose.dev.yml up -d postgres && sleep 5 && \
  docker compose -f docker-compose.dev.yml exec -T postgres pg_restore -U \"\$POSTGRES_USER\" -d \"\$POSTGRES_DB\" --clean --if-exists --no-owner < /tmp/keyloka_dev.dump && \
  rm /tmp/keyloka_dev.dump && docker compose -f docker-compose.dev.yml up -d api"
rm -f "$DUMP"
echo "Selesai: DB dev terisi dari local."
