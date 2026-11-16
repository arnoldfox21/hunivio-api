#!/usr/bin/env bash
set -e

PG_BIN="/Applications/Postgres.app/Contents/Versions/16/bin"
PG_DATA="/Users/kurniawank/Documents/Projects/keyloka-api/.pgdata"

if [ ! -d "$PG_DATA" ]; then
  echo "📦 Menginisialisasi cluster database PostgreSQL lokal di $PG_DATA..."
  "$PG_BIN/initdb" -D "$PG_DATA" -U postgres --auth=trust -E UTF8 --no-locale
fi

if ! "$PG_BIN/pg_isready" -h 127.0.0.1 -p 5432 >/dev/null 2>&1; then
  echo "🐘 Menjalankan server PostgreSQL lokal di port 5432..."
  "$PG_BIN/pg_ctl" -D "$PG_DATA" -l "$PG_DATA/postgres.log" start
fi

if ! "$PG_BIN/psql" -h 127.0.0.1 -U postgres -lqt | cut -d \| -f 1 | grep -qw keyloka_db; then
  echo "🛠️ Membuat database keyloka_db..."
  "$PG_BIN/createdb" -h 127.0.0.1 -U postgres keyloka_db
fi

echo "✅ PostgreSQL siap di 127.0.0.1:5432 (database: keyloka_db)"
