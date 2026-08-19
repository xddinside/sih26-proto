#!/usr/bin/env bash
# Local PostgreSQL lifecycle for dev/test. Uses the `sg docker` wrapper this
# machine requires (plain `docker` is permission-denied). No credentials or
# container volumes are committed; the container is ephemeral.
#
#   scripts/db.sh start   boot postgres:16-alpine on :5433, wait for readiness,
#                         apply db/init.sql
#   scripts/db.sh reset   drop and re-apply the schema
#   scripts/db.sh stop    remove the container
set -euo pipefail

NAME=sih-control-plane-pg
PORT="${SIH_PG_PORT:-5433}"
DB_USER=sih
DB_PASSWORD=sih
DB_NAME=sih_control_plane

docker() { sg docker -c "docker $*"; }

case "${1:-}" in
  start)
    if docker inspect "$NAME" >/dev/null 2>&1; then
      echo "[db] container $NAME already running"
    else
      echo "[db] starting postgres:16-alpine on :$PORT"
      docker run -d --name "$NAME" \
        -e POSTGRES_USER="$DB_USER" -e POSTGRES_PASSWORD="$DB_PASSWORD" \
        -e POSTGRES_DB="$DB_NAME" \
        -p "127.0.0.1:$PORT:5432" postgres:16-alpine
    fi
    for i in $(seq 1 30); do
      if docker exec "$NAME" pg_isready -U "$DB_USER" >/dev/null 2>&1; then
        break
      fi
      sleep 1
    done
    echo "[db] applying db/init.sql"
    docker exec -i "$NAME" psql -U "$DB_USER" -d "$DB_NAME" \
      < "$(dirname "$0")/../db/init.sql"
    for test_db in sih_test_state sih_test_leases sih_test_orchestrator-work; do
      docker exec "$NAME" createdb -U "$DB_USER" "$test_db" 2>/dev/null || true
    done
    echo "[db] ready at postgres://$DB_USER:***@127.0.0.1:$PORT/$DB_NAME"
    ;;
  reset)
    echo "[db] dropping and re-applying schema"
    docker exec -i "$NAME" psql -U "$DB_USER" -d "$DB_NAME" -c \
      'drop schema public cascade; create schema public;'
    docker exec -i "$NAME" psql -U "$DB_USER" -d "$DB_NAME" \
      < "$(dirname "$0")/../db/init.sql"
    echo "[db] reset complete"
    ;;
  stop)
    docker rm -f "$NAME" >/dev/null 2>&1 || true
    echo "[db] stopped"
    ;;
  *)
    echo "usage: $0 {start|reset|stop}"
    exit 2
    ;;
esac
