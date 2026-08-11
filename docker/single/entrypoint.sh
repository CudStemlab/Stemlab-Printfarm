#!/usr/bin/env bash
# Supervisor for the all-in-one print-farm image (Dockerfile.single).
#
# Starts, in order: PostgreSQL (in-container, unless an external DATABASE_URL is
# supplied), the Go exporter, the Go poller, and the Node web server (which also
# hosts the slicer proxy and the MCP server in-process). If any of them exits the
# whole container exits, so Docker's restart policy restarts a clean stack rather
# than leaving a half-dead container serving errors.
#
# Everything runs as the unprivileged `printfarm` user — including PostgreSQL,
# which refuses to run as root but is fine as any other owner of $PGDATA.
set -euo pipefail

log() { echo "[entrypoint] $*"; }
fail() { echo "[entrypoint] ERROR: $*" >&2; exit 1; }

PGDATA="${PGDATA:-/var/lib/printfarm/pgdata}"
PGHOST_ADDR="${EMBEDDED_POSTGRES_HOST:-127.0.0.1}"
PGPORT_NUM="${EMBEDDED_POSTGRES_PORT:-5432}"
EMBEDDED_POSTGRES="${EMBEDDED_POSTGRES:-true}"
RUN_POLLER="${RUN_POLLER:-true}"
RUN_EXPORTER="${RUN_EXPORTER:-true}"

urlencode() { node -e 'process.stdout.write(encodeURIComponent(process.argv[1]))' "$1"; }

# ---------------------------------------------------------------------------
# PostgreSQL
# ---------------------------------------------------------------------------
start_embedded_postgres() {
  : "${POSTGRES_USER:?set POSTGRES_USER}"
  : "${POSTGRES_PASSWORD:?set POSTGRES_PASSWORD}"
  : "${POSTGRES_DB:?set POSTGRES_DB}"

  if [ ! -s "$PGDATA/PG_VERSION" ]; then
    log "initializing PostgreSQL cluster in $PGDATA"
    mkdir -p "$PGDATA"
    chmod 700 "$PGDATA"
    # The superuser password is passed by file, never on the command line (it
    # would otherwise show up in `ps` for every process in the container).
    pwfile="$(mktemp)"
    printf '%s' "$POSTGRES_PASSWORD" > "$pwfile"
    initdb \
      --username="$POSTGRES_USER" \
      --pwfile="$pwfile" \
      --auth-local=trust \
      --auth-host=scram-sha-256 \
      --encoding=UTF8 \
      --locale=C.UTF-8 \
      -D "$PGDATA" >/dev/null
    rm -f "$pwfile"

    # Loopback only: nothing outside this container can reach the database, so
    # there is no port to publish and no network boundary to defend.
    cat >> "$PGDATA/postgresql.conf" <<CONF

# --- printfarm single-container settings ---
listen_addresses = '127.0.0.1'
port = ${PGPORT_NUM}
unix_socket_directories = '/var/run/postgresql'
CONF
    echo "host all all 127.0.0.1/32 scram-sha-256" >> "$PGDATA/pg_hba.conf"
  fi

  log "starting PostgreSQL"
  pg_ctl -D "$PGDATA" -l /var/log/printfarm/postgres.log -w -t 60 start \
    || { tail -n 50 /var/log/printfarm/postgres.log >&2 || true; fail "PostgreSQL failed to start"; }

  # Created on first boot only; harmless (and skipped) on every later start.
  if ! psql -h /var/run/postgresql -U "$POSTGRES_USER" -d postgres -tAc \
        "SELECT 1 FROM pg_database WHERE datname = '${POSTGRES_DB}'" | grep -q 1; then
    log "creating database ${POSTGRES_DB}"
    createdb -h /var/run/postgresql -U "$POSTGRES_USER" "$POSTGRES_DB"
  fi

  if [ -z "${DATABASE_URL:-}" ]; then
    export DATABASE_URL="postgresql://$(urlencode "$POSTGRES_USER"):$(urlencode "$POSTGRES_PASSWORD")@${PGHOST_ADDR}:${PGPORT_NUM}/$(urlencode "$POSTGRES_DB")"
  fi
}

if [ "$EMBEDDED_POSTGRES" = "true" ]; then
  start_embedded_postgres
else
  : "${DATABASE_URL:?set DATABASE_URL when EMBEDDED_POSTGRES=false}"
  log "using external database (embedded PostgreSQL disabled)"
fi

# The web server owns schema creation and the ordered migrations; the poller and
# exporter must not race it on a cold database, so they start after it is ready.
export DATABASE_URL

# ---------------------------------------------------------------------------
# Child processes
# ---------------------------------------------------------------------------
declare -a CHILD_PIDS=()
declare -a CHILD_NAMES=()
shutting_down=0

spawn() {
  local name="$1"; shift
  log "starting ${name}"
  "$@" &
  CHILD_PIDS+=("$!")
  CHILD_NAMES+=("$name")
}

shutdown() {
  [ "$shutting_down" = "1" ] && return
  shutting_down=1
  log "shutting down"
  for pid in "${CHILD_PIDS[@]}"; do
    kill -TERM "$pid" 2>/dev/null || true
  done
  # Give the poller time to close its Bambu MQTT connections and the web server
  # time to finish in-flight responses before the database goes away.
  local waited=0
  while [ "$waited" -lt 20 ]; do
    local alive=0
    for pid in "${CHILD_PIDS[@]}"; do
      kill -0 "$pid" 2>/dev/null && alive=1
    done
    [ "$alive" = "0" ] && break
    sleep 1
    waited=$((waited + 1))
  done
  if [ "$EMBEDDED_POSTGRES" = "true" ]; then
    pg_ctl -D "$PGDATA" -m fast -w -t 30 stop >/dev/null 2>&1 || true
  fi
}
trap 'shutdown; exit 0' TERM INT

# Node web server: SPA + /api/* + /api/v1 + printer proxy/webcam + the embedded
# slicer proxy (/printers/) and MCP server (/mcp), plus the status-light broker.
export EMBED_SLICER_PROXY="${EMBED_SLICER_PROXY:-true}"
export EMBED_MCP="${EMBED_MCP:-true}"
# No nginx to 404 /metrics on the public port any more — move it to its own.
export METRICS_LISTEN_PORT="${METRICS_LISTEN_PORT:-9181}"
spawn "web" node /app/server/app.js

# Wait for the web server to apply the schema before the Go services touch the DB.
for _ in $(seq 1 60); do
  if node -e "fetch('http://127.0.0.1:'+(process.env.PORT||5173)+'/readyz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))" 2>/dev/null; then
    break
  fi
  sleep 1
done

if [ "$RUN_EXPORTER" = "true" ]; then
  spawn "exporter" /usr/local/bin/printfarm-exporter
fi

if [ "$RUN_POLLER" = "true" ]; then
  # Bambu snapshots for Discord notifications come from the web server's webcam
  # endpoint, which is now in this same container.
  export WEB_SNAPSHOT_BASE_URL="${WEB_SNAPSHOT_BASE_URL:-http://127.0.0.1:${PORT:-5173}}"
  spawn "poller" /usr/local/bin/printfarm-poller
fi

log "all services started"

# First child to exit takes the container down with it, so a supervisor-less
# stack can't silently degrade (e.g. web dead, poller still writing).
wait -n
status=$?
log "a service exited (status ${status}) — stopping the container"
shutdown
exit "${status:-1}"
