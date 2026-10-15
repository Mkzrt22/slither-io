#!/usr/bin/env bash
# -----------------------------------------------------------------------------
# Tests de la base (schéma + RLS) sur un Postgres 16 local jetable, sans Docker.
#   npm run test:db
# Prérequis : postgresql-16, postgresql-16-pgvector, postgresql-16-pgtap.
# Alternative avec la CLI Supabase (Docker) : `supabase test db`.
# -----------------------------------------------------------------------------
set -euo pipefail
cd "$(dirname "$0")/.."

PGBIN="${PGBIN:-$(ls -d /usr/lib/postgresql/*/bin 2>/dev/null | sort -V | tail -1)}"
PORT="${PGPORT_TEST:-54329}"
DATA="$(mktemp -d)"
RUN=()
if [ "$(id -u)" = "0" ]; then
  # initdb refuse de tourner en root : on délègue à l'utilisateur système postgres.
  chown postgres "$DATA"
  RUN=(runuser -u postgres --)
fi

cleanup() {
  "${RUN[@]}" "$PGBIN/pg_ctl" -D "$DATA/db" stop -m immediate >/dev/null 2>&1 || true
  rm -rf "$DATA"
}
trap cleanup EXIT

"${RUN[@]}" "$PGBIN/initdb" -D "$DATA/db" -U postgres --auth=trust >/dev/null
"${RUN[@]}" "$PGBIN/pg_ctl" -D "$DATA/db" -l "$DATA/db/server.log" \
  -o "-p $PORT -k $DATA -c listen_addresses=''" -w start >/dev/null

PSQL=(psql -h "$DATA" -p "$PORT" -U postgres -v ON_ERROR_STOP=1 -q -X)
"${PSQL[@]}" -d postgres -c "create database flowrima_test" >/dev/null
"${PSQL[@]}" -d flowrima_test -f scripts/db/supabase_stub.sql >/dev/null

for f in supabase/migrations/*.sql; do
  echo "→ migration $(basename "$f")"
  "${PSQL[@]}" -d flowrima_test -f "$f" >/dev/null
done

status=0
for t in supabase/tests/*.test.sql; do
  echo "→ test $(basename "$t")"
  out="$("${PSQL[@]}" -d flowrima_test -t -A -f "$t" 2>&1)" || status=1
  echo "$out" | grep -v '^$'
  if echo "$out" | grep -qE '^not ok|ERROR|Looks like'; then status=1; fi
done

if [ "$status" = "0" ]; then echo "✅ Tests base de données : OK"; else echo "❌ Tests base de données : ÉCHEC"; fi
exit "$status"
