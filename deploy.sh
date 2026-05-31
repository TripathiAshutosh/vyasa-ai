#!/usr/bin/env bash
# Push this project to a DigitalOcean droplet over rsync, then (optionally)
# run ./run.sh on the droplet so it builds + starts the stack remotely.
#
# Usage:
#   ./deploy.sh                # rsync + remote './run.sh'
#   ./deploy.sh sync           # rsync only, don't run anything
#   ./deploy.sh ssh            # interactive shell on the droplet
#   ./deploy.sh logs           # tail droplet logs (./run.sh logs)
#   ./deploy.sh ingest         # trigger /api/documents/refresh on the droplet
#
# Configure once: copy .deploy.env.example -> .deploy.env and fill in:
#   DEPLOY_HOST=root@1.2.3.4
#   DEPLOY_PATH=/opt/phd_bot

set -euo pipefail
cd "$(dirname "$0")"

err()  { printf '\033[31mERROR:\033[0m %s\n' "$*" >&2; }
ok()   { printf '\033[32mOK   :\033[0m %s\n'  "$*"; }
say()  { printf '       %s\n' "$*"; }

# Allow --help before requiring .deploy.env.
case "${1:-}" in
  -h|--help)
    sed -n '2,12p' "$0" | sed 's/^# \{0,1\}//'
    exit 0
    ;;
esac

if [ ! -f .deploy.env ]; then
  err ".deploy.env missing."
  say "Copy the template and fill it in:"
  say "  cp .deploy.env.example .deploy.env && \$EDITOR .deploy.env"
  exit 1
fi
# shellcheck disable=SC1091
set -a; . ./.deploy.env; set +a

: "${DEPLOY_HOST:?DEPLOY_HOST not set in .deploy.env (e.g. root@1.2.3.4)}"
: "${DEPLOY_PATH:?DEPLOY_PATH not set in .deploy.env (e.g. /opt/phd_bot)}"

SSH_OPTS=(-o StrictHostKeyChecking=accept-new -o ServerAliveInterval=30)

remote() { ssh "${SSH_OPTS[@]}" "$DEPLOY_HOST" "cd '$DEPLOY_PATH' && $*"; }

CMD="${1:-up}"

case "$CMD" in
  ssh)
    exec ssh "${SSH_OPTS[@]}" "$DEPLOY_HOST" -t "cd '$DEPLOY_PATH' && exec \$SHELL -l"
    ;;
  logs)
    exec ssh "${SSH_OPTS[@]}" "$DEPLOY_HOST" -t "cd '$DEPLOY_PATH' && ./run.sh logs"
    ;;
  ingest)
    remote "./run.sh ingest"
    exit 0
    ;;
  sync|up|"")
    : # falls through to rsync below
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

# ---------- prep remote ----------
ok "Ensuring $DEPLOY_PATH exists on $DEPLOY_HOST..."
remote "mkdir -p '$DEPLOY_PATH' '$DEPLOY_PATH/data'"

# ---------- rsync ----------
# Exclude:
#  - secrets that should be managed on the droplet (.env, models.config.json)
#  - build artefacts (node_modules, .next, .venv, __pycache__)
#  - the local Chroma index (droplet keeps its own in a docker volume)
#  - VCS noise
ok "Syncing project to ${DEPLOY_HOST}:${DEPLOY_PATH}..."
rsync -az --delete \
  --info=stats1,progress2 \
  --exclude='.git/' \
  --exclude='.env' \
  --exclude='.env.local' \
  --exclude='.deploy.env' \
  --exclude='backend/models.config.json' \
  --exclude='backend/.env' \
  --exclude='backend/.venv/' \
  --exclude='backend/chroma_db/' \
  --exclude='backend/chroma_db_test/' \
  --exclude='backend/__pycache__/' \
  --exclude='**/__pycache__/' \
  --exclude='*.pyc' \
  --exclude='frontend/node_modules/' \
  --exclude='frontend/.next/' \
  --exclude='frontend/.swc/' \
  --exclude='.DS_Store' \
  -e "ssh ${SSH_OPTS[*]}" \
  ./ "${DEPLOY_HOST}:${DEPLOY_PATH}/"

ok "Sync complete."

# ---------- run remotely (only for 'up' / default) ----------
if [ "$CMD" = "sync" ]; then
  say "Done. To start the stack on the droplet:"
  say "  ./deploy.sh        # or:  ssh $DEPLOY_HOST 'cd $DEPLOY_PATH && ./run.sh'"
  exit 0
fi

# Sanity-check the droplet has the secret files (we never sync them).
if ! remote "test -f .env"; then
  err "No .env on the droplet yet — create it once before first 'up':"
  say "  ssh $DEPLOY_HOST"
  say "  cd $DEPLOY_PATH"
  say "  cp .env.example .env && \$EDITOR .env       # set PROVIDER, keys, ADMIN_TOKEN"
  say "  # (opensource mode) cp backend/models.config.example.json backend/models.config.json"
  say "  ./run.sh"
  exit 1
fi

ok "Running ./run.sh on the droplet..."
ssh "${SSH_OPTS[@]}" "$DEPLOY_HOST" -t "cd '$DEPLOY_PATH' && ./run.sh"
