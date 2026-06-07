#!/usr/bin/env bash
# Build images + run containers for the PhD Admission Bot stack
# (backend + frontend + Caddy). Works locally and on a DigitalOcean droplet.
#
# Usage:
#   ./run.sh                # build + start everything, wait for health, ingest if empty
#   ./run.sh up             # same as above
#   ./run.sh down           # stop + remove containers (volumes preserved)
#   ./run.sh logs           # tail logs from all services
#   ./run.sh ps             # show container status
#   ./run.sh ingest         # trigger /api/documents/refresh
#   ./run.sh backup         # snapshot analytics DB to ./backups/ (auto-runs before 'up')
#   ./run.sh restore FILE   # restore analytics DB from a snapshot in ./backups/
#   ./run.sh up --no-cache  # force a clean rebuild
#   ./run.sh up --reingest  # build + start + force re-embed all PDFs in data/

set -euo pipefail
cd "$(dirname "$0")"

# ---------- pretty logging ----------
err()  { printf '\033[31mERROR:\033[0m %s\n' "$*" >&2; }
warn() { printf '\033[33mWARN :\033[0m %s\n'  "$*" >&2; }
ok()   { printf '\033[32mOK   :\033[0m %s\n'  "$*"; }
say()  { printf '       %s\n' "$*"; }

# Read a single KEY=value from .env (strips surrounding quotes/whitespace).
read_env() {
  [ -f .env ] || return 0
  grep -E "^${1}=" .env 2>/dev/null | tail -n1 | cut -d= -f2- \
    | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//' \
          -e 's/^"//' -e 's/"$//' -e "s/^'//" -e "s/'$//" || true
}

# ---------- detect docker + compose ----------
if ! command -v docker >/dev/null 2>&1; then
  err "docker not installed."
  say "Install on a fresh Ubuntu droplet:  curl -fsSL https://get.docker.com | sh"
  exit 1
fi

if docker compose version >/dev/null 2>&1; then
  COMPOSE=(docker compose)
elif command -v docker-compose >/dev/null 2>&1; then
  COMPOSE=(docker-compose)
else
  err "docker compose plugin not found."
  say "Install:  apt-get install -y docker-compose-plugin"
  exit 1
fi

# ---------- analytics DB backup helpers ----------
BACKUP_DIR=backups
ANALYTICS_DB=/app/analytics/analytics.db

backend_cid() { "${COMPOSE[@]}" ps -q backend 2>/dev/null | head -n1; }

# Online snapshot of the analytics SQLite DB via the running backend container.
# The image has no sqlite3 CLI; Python's backup API is WAL-safe (zero downtime).
# Snapshots land on the host, outside the docker volume, so 'down -v' or a
# volume wipe can't take them along. Keeps the newest 14.
do_backup() {
  local cid stamp dest
  cid=$(backend_cid)
  if [ -z "$cid" ]; then
    warn "Backend not running — cannot back up analytics DB."
    return 1
  fi
  if ! docker exec "$cid" test -f "$ANALYTICS_DB" 2>/dev/null; then
    say "No analytics DB yet — nothing to back up."
    return 0
  fi
  stamp=$(date +%Y%m%d-%H%M%S)
  dest="${BACKUP_DIR}/analytics-${stamp}.db"
  mkdir -p "$BACKUP_DIR"
  if docker exec "$cid" python -c "
import sqlite3
src = sqlite3.connect('file:${ANALYTICS_DB}?mode=ro', uri=True)
dst = sqlite3.connect('/tmp/analytics-backup.db')
src.backup(dst)
dst.close(); src.close()
" \
     && docker cp "$cid":/tmp/analytics-backup.db "$dest" >/dev/null \
     && docker exec "$cid" rm -f /tmp/analytics-backup.db; then
    ok "Analytics backup: $dest ($(du -h "$dest" | cut -f1))"
  else
    rm -f "$dest"
    warn "Analytics backup FAILED."
    return 1
  fi
  # Retention: newest 14 snapshots, newest 5 pre-restore safety copies.
  ls -1t "${BACKUP_DIR}"/analytics-*.db 2>/dev/null | tail -n +15 | xargs -r rm -f --
  ls -1t "${BACKUP_DIR}"/pre-restore-* 2>/dev/null | tail -n +6 | xargs -r rm -f --
}

# ---------- subcommand dispatch ----------
CMD="${1:-up}"; [ $# -gt 0 ] && shift || true

case "$CMD" in
  down)
    ok "Stopping containers..."
    "${COMPOSE[@]}" down "$@"
    exit 0
    ;;
  logs)
    exec "${COMPOSE[@]}" logs -f "$@"
    ;;
  ps)
    exec "${COMPOSE[@]}" ps "$@"
    ;;
  ingest)
    : # handled below after env preflight
    ;;
  backup)
    do_backup
    exit $?
    ;;
  restore)
    FILE="${1:-}"
    if [ -z "$FILE" ] || [ ! -f "$FILE" ]; then
      err "Usage: $0 restore ${BACKUP_DIR}/analytics-YYYYmmdd-HHMMSS.db"
      if ls "${BACKUP_DIR}"/analytics-*.db >/dev/null 2>&1; then
        say "Available snapshots (newest first):"
        ls -1t "${BACKUP_DIR}"/analytics-*.db | sed 's/^/         /'
      fi
      exit 2
    fi
    # Sanity: refuse to restore anything that isn't a healthy analytics DB.
    if ! python3 - "$FILE" <<'PY'
import sqlite3, sys
try:
    conn = sqlite3.connect(f"file:{sys.argv[1]}?mode=ro", uri=True)
    healthy = conn.execute("PRAGMA integrity_check").fetchone()[0] == "ok"
    has_events = conn.execute(
        "SELECT count(*) FROM sqlite_master WHERE name='events'"
    ).fetchone()[0] == 1
except sqlite3.Error:
    sys.exit(1)
sys.exit(0 if healthy and has_events else 1)
PY
    then
      err "$FILE failed the integrity check (or isn't an analytics DB) — aborting."
      exit 1
    fi

    cid=$("${COMPOSE[@]}" ps -aq backend | head -n1)
    if [ -z "$cid" ]; then
      err "No backend container found — run '$0 up' once first."
      exit 1
    fi
    img=$(docker inspect "$cid" --format '{{.Config.Image}}')
    vol=$(docker inspect "$cid" --format \
      '{{range .Mounts}}{{if eq .Destination "/app/analytics"}}{{.Name}}{{end}}{{end}}')
    if [ -z "$vol" ]; then
      err "Could not resolve the analytics docker volume."
      exit 1
    fi

    ok "Stopping backend..."
    "${COMPOSE[@]}" stop backend >/dev/null

    # Safety net: raw copy of the current DB (incl. WAL files) so the restore
    # itself is reversible — even if the live DB is corrupt.
    stamp=$(date +%Y%m%d-%H%M%S)
    mkdir -p "$BACKUP_DIR"
    if docker run --rm -v "$vol":/a -v "$(pwd)/${BACKUP_DIR}":/b "$img" sh -c "
         for f in analytics.db analytics.db-wal analytics.db-shm; do
           [ -f /a/\$f ] && cp /a/\$f /b/pre-restore-${stamp}-\$f
         done; true"; then
      ok "Current DB saved as ${BACKUP_DIR}/pre-restore-${stamp}-*"
    else
      warn "Could not snapshot the current DB — continuing with restore."
    fi

    # Replace the DB: stage the new file first, then drop stale -wal/-shm
    # (leftovers from the old DB would corrupt the restored one), then swap.
    # If anything fails, the original DB is untouched and the backend restarts.
    fdir=$(cd "$(dirname "$FILE")" && pwd); fname=$(basename "$FILE")
    if ! docker run --rm -v "$vol":/a -v "$fdir":/restore:ro "$img" sh -c "
        cp /restore/${fname} /a/analytics.db.new &&
        rm -f /a/analytics.db-wal /a/analytics.db-shm &&
        mv /a/analytics.db.new /a/analytics.db"; then
      err "Restore copy failed — restarting backend with the ORIGINAL DB."
      "${COMPOSE[@]}" start backend >/dev/null
      exit 1
    fi

    ok "Restored ${fname}. Starting backend..."
    "${COMPOSE[@]}" start backend >/dev/null

    HTTP_PORT=$(read_env HTTP_PORT); HTTP_PORT=${HTTP_PORT:-80}
    printf 'Waiting for backend'
    for _ in $(seq 1 60); do
      if curl -sf "http://localhost:${HTTP_PORT}/api/health" >/dev/null 2>&1; then
        printf ' ready.\n'
        ok "Restore complete."
        exit 0
      fi
      printf '.'
      sleep 1
    done
    echo
    err "Backend didn't become healthy after restore — check '$0 logs'."
    exit 1
    ;;
  up|"")
    CMD=up
    ;;
  -h|--help)
    sed -n '2,15p' "$0" | sed 's/^# \{0,1\}//'
    exit 0
    ;;
  *)
    err "Unknown command: $CMD"
    say "Run '$0 --help' for usage."
    exit 2
    ;;
esac

# ---------- .env preflight ----------
if [ ! -f .env ]; then
  warn ".env missing — copying .env.example → .env"
  cp .env.example .env
  err "Now edit .env (PROVIDER, API keys, ADMIN_TOKEN), then rerun '$0'."
  exit 1
fi

PROVIDER=$(read_env PROVIDER); PROVIDER=${PROVIDER:-openai}
ADMIN_TOKEN=$(read_env ADMIN_TOKEN)
HTTP_PORT=$(read_env HTTP_PORT); HTTP_PORT=${HTTP_PORT:-80}

if [ -z "$ADMIN_TOKEN" ] || [ "$ADMIN_TOKEN" = "change-me" ] || [ "$ADMIN_TOKEN" = "please-change-me" ]; then
  err "ADMIN_TOKEN is unset (or still a placeholder) in .env."
  exit 1
fi

case "$PROVIDER" in
  openai)
    if [ -z "$(read_env OPENAI_API_KEY)" ]; then
      err "PROVIDER=openai but OPENAI_API_KEY is empty in .env."
      exit 1
    fi
    ;;
  opensource)
    have_groq_env=$(read_env GROQ_API_KEY)
    have_groq_json=0
    if [ -f backend/models.config.json ]; then
      # Confirm the JSON actually carries an api_key — not just an empty stub.
      if python3 -c "
import json, sys
try:
    d = json.load(open('backend/models.config.json'))
    for m in (d.get('custom_models') or []):
        if (m.get('api_key') or '').strip() and not m['api_key'].endswith('REPLACE_ME'):
            sys.exit(0)
    sys.exit(1)
except Exception:
    sys.exit(1)
" 2>/dev/null; then
        have_groq_json=1
      fi
    fi
    if [ -z "$have_groq_env" ] && [ "$have_groq_json" = "0" ]; then
      err "PROVIDER=opensource needs GROQ_API_KEY in .env OR a real api_key in backend/models.config.json."
      exit 1
    fi
    if [ -z "$(read_env JINA_API_KEY)" ]; then
      err "PROVIDER=opensource needs JINA_API_KEY in .env (embeddings + reranker)."
      exit 1
    fi
    ;;
  *)
    err "PROVIDER must be 'openai' or 'opensource', got: '$PROVIDER'"
    exit 1
    ;;
esac

# ---------- 'ingest' subcommand can now run ----------
if [ "$CMD" = "ingest" ]; then
  ok "Triggering /api/documents/refresh..."
  curl -fsS -X POST "http://localhost:${HTTP_PORT}/api/documents/refresh" \
       -H "X-Admin-Token: ${ADMIN_TOKEN}" | tee /dev/stderr
  echo
  exit 0
fi

# ---------- data folder ----------
mkdir -p data
pdf_count=$(find data -maxdepth 1 -type f -iname '*.pdf' 2>/dev/null | wc -l | tr -d ' ')

# ---------- ensure models.config.json exists (bind-mount target) ----------
# Compose would create an empty directory at this path if the file is missing,
# which then masks the loader. Drop in a harmless empty stub instead.
if [ ! -f backend/models.config.json ]; then
  printf '{"custom_models": []}\n' > backend/models.config.json
  ok "Created empty backend/models.config.json stub (no custom models)."
fi
if [ "$pdf_count" = "0" ]; then
  warn "data/ has no PDFs yet — the bot will start but answer nothing until you upload some."
else
  ok "Found $pdf_count PDF(s) in data/."
fi

# ---------- build flags ----------
BUILD_FLAGS=()
FORCE_REINGEST=0
for arg in "$@"; do
  case "$arg" in
    --no-cache)  BUILD_FLAGS+=(--no-cache) ;;
    --pull)      BUILD_FLAGS+=(--pull) ;;
    --reingest)  FORCE_REINGEST=1 ;;
  esac
done

# ---------- build + up ----------
ok "Provider:    $PROVIDER"
ok "Compose:     ${COMPOSE[*]}"
ok "Host port:   ${HTTP_PORT}"
echo

# ---------- pre-deploy analytics backup ----------
# Every deploy gets a pre-deploy snapshot to roll back to. A backup failure
# warns but doesn't block the deploy. First run (no container yet) skips.
if [ -n "$(backend_cid)" ]; then
  ok "Backing up analytics DB before deploy..."
  do_backup || warn "Proceeding without a fresh backup!"
fi

ok "Building images and starting containers..."
if [ ${#BUILD_FLAGS[@]} -gt 0 ]; then
  "${COMPOSE[@]}" build "${BUILD_FLAGS[@]}"
fi
"${COMPOSE[@]}" up -d --build --remove-orphans

# ---------- wait for backend health ----------
printf 'Waiting for backend'
ready=0
for _ in $(seq 1 60); do
  if curl -sf "http://localhost:${HTTP_PORT}/api/health" >/dev/null 2>&1; then
    ready=1; printf ' ready.\n'; break
  fi
  printf '.'
  sleep 1
done
if [ "$ready" != "1" ]; then
  echo
  err "Backend didn't become healthy in 60s."
  say "Check logs:  $0 logs"
  exit 1
fi

# ---------- ingest if empty, or forced via --reingest ----------
chunks=$(curl -sf "http://localhost:${HTTP_PORT}/api/health" \
  | python3 -c "import sys,json;print(json.load(sys.stdin).get('num_chunks',0))" 2>/dev/null || echo 0)

should_ingest=0
reason=""
if [ "$FORCE_REINGEST" = "1" ] && [ "$pdf_count" != "0" ]; then
  should_ingest=1
  reason="--reingest requested"
elif [ "$chunks" = "0" ] && [ "$pdf_count" != "0" ]; then
  should_ingest=1
  reason="index empty"
fi

if [ "$should_ingest" = "1" ]; then
  ok "Ingesting $pdf_count PDF(s) — $reason..."
  if curl -fsS -X POST "http://localhost:${HTTP_PORT}/api/documents/refresh" \
        -H "X-Admin-Token: ${ADMIN_TOKEN}" -o /tmp/phd_bot_ingest.json; then
    say "$(cat /tmp/phd_bot_ingest.json)"
    rm -f /tmp/phd_bot_ingest.json
    ok "Ingestion complete."
  else
    warn "Ingestion failed — trigger from /admin instead."
  fi
fi

# ---------- summary ----------
echo
"${COMPOSE[@]}" ps
echo
ok "All up."
say "App:         http://localhost:${HTTP_PORT}"
say "API health:  http://localhost:${HTTP_PORT}/api/health"
say "Logs:        $0 logs"
say "Re-ingest:   $0 ingest"
say "Stop:        $0 down"
