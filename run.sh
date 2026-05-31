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
#   ./run.sh up --no-cache  # force a clean rebuild

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
  up|"")
    CMD=up
    ;;
  -h|--help)
    sed -n '2,12p' "$0" | sed 's/^# \{0,1\}//'
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
for arg in "$@"; do
  case "$arg" in
    --no-cache) BUILD_FLAGS+=(--no-cache) ;;
    --pull)     BUILD_FLAGS+=(--pull) ;;
  esac
done

# ---------- build + up ----------
ok "Provider:    $PROVIDER"
ok "Compose:     ${COMPOSE[*]}"
ok "Host port:   ${HTTP_PORT}"
echo

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

# ---------- first-time ingest if empty + data present ----------
chunks=$(curl -sf "http://localhost:${HTTP_PORT}/api/health" \
  | python3 -c "import sys,json;print(json.load(sys.stdin).get('num_chunks',0))" 2>/dev/null || echo 0)

if [ "$chunks" = "0" ] && [ "$pdf_count" != "0" ]; then
  ok "Index is empty — ingesting $pdf_count PDF(s)..."
  if curl -fsS -X POST "http://localhost:${HTTP_PORT}/api/documents/refresh" \
        -H "X-Admin-Token: ${ADMIN_TOKEN}" -o /tmp/phd_bot_ingest.json; then
    say "$(cat /tmp/phd_bot_ingest.json)"
    rm -f /tmp/phd_bot_ingest.json
    ok "Ingestion complete."
  else
    warn "Initial ingestion failed — trigger from the UI sidebar instead."
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
