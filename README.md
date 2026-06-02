# PhD Admission Q&A Bot

A minimal, production-feeling RAG chatbot that answers PhD admission questions from official
PDF documents. Switchable between **OpenAI** and an **open-source** stack (Groq + Jina) via a
single environment variable, with no local model weights.

- **Frontend:** Next.js 15 (App Router) + Tailwind + shadcn/ui primitives
- **Backend:** FastAPI + ChromaDB (embedded) + PyMuPDF
- **Providers:**
  - `PROVIDER=openai` → `gpt-4o-mini` + `text-embedding-3-small`
  - `PROVIDER=opensource` → Groq `llama-3.3-70b-versatile` + Jina `jina-embeddings-v3` + Jina reranker
- **Deploy:** single $6 DigitalOcean droplet via `docker compose` behind Caddy (auto-TLS)

---

## Repo layout

```
phd_bot/
├── backend/            # FastAPI app, Dockerfile, requirements.txt
├── frontend/           # Next.js app, Dockerfile, package.json
├── data/               # Source PDFs (mounted into backend)
├── docker-compose.yml
├── Caddyfile
└── .env.example        # Root env, consumed by docker-compose
```

## Quick start — local dev (Docker, recommended)

The same `./run.sh` that ships to the droplet runs locally. You only need Docker.

```bash
cp .env.example .env                # fill in keys + ADMIN_TOKEN; set HTTP_PORT=8080 if 80 is taken
./run.sh                            # builds, starts, auto-ingests data/ on first run
```

Then open <http://localhost> (or whatever `HTTP_PORT` you set). Admin dashboard at `/admin`.

### Local dev — without Docker (hot-reload)

For iterating on backend code with `uvicorn --reload`:

```bash
# Terminal 1 — backend
cd backend
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env          # fill in keys + ADMIN_TOKEN
export DATA_DIR=../data CHROMA_DIR=./chroma_db
uvicorn app.main:app --reload --port 8000

# Terminal 2 — frontend
cd frontend
cp .env.local.example .env.local   # NEXT_PUBLIC_API_URL=http://localhost:8000
npm install
npm run dev                         # http://localhost:3000
```

Trigger the first index build (one time):
```bash
curl -X POST http://localhost:8000/api/documents/refresh \
     -H "X-Admin-Token: $(grep ^ADMIN_TOKEN backend/.env | cut -d= -f2)"
```

## Using a Groq custom-models JSON

If you already have a Groq export like this:

```json
{
  "custom_models": [
    {
      "model_display_name": "GPT-OSS 120B [Groq]",
      "model": "openai/gpt-oss-120b",
      "base_url": "https://api.groq.com/openai/v1",
      "api_key": "gsk_…",
      "provider": "generic-chat-completion-api",
      "max_tokens": 65536
    }
  ]
}
```

Drop it at `backend/models.config.json` (gitignored). On startup the backend will use its
`model`, `base_url`, `api_key`, and `max_tokens` instead of the corresponding `GROQ_*` env
vars — so you don't need to copy them into `.env`. To select a specific entry when the file
has more than one model, set `MODELS_CONFIG_SELECT` to the `model_display_name` (or `model`).
A template is provided at `backend/models.config.example.json`.

`max_tokens` is clamped to 8192 — Q&A answers never need more, and large values waste budget.

## Switching providers

Edit `backend/.env` (local) or root `.env` (compose):

```ini
PROVIDER=openai        # uses OPENAI_API_KEY
# or
PROVIDER=opensource    # uses GROQ_API_KEY + JINA_API_KEY
```

Restart the backend. The provider badge in the sidebar shows which path is live.

> **Note:** Switching providers does **not** automatically re-embed existing chunks. If you
> change embedding providers, click **Refresh index** in the sidebar (or POST `/api/documents/refresh`)
> so vectors are regenerated with the new embedder.

## Admin actions

Admin operations (upload PDFs, refresh index, delete) live on a hidden route:

```
http(s)://your-host/admin
```

This URL isn't linked from the public chat (`/`) so embedded portal users don't see it.
Anyone who lands on `/admin` still needs the `ADMIN_TOKEN` to actually perform any action.
Set `ADMIN_TOKEN` in `.env`; the UI prompts for it once and stores it in browser `localStorage`.

`/admin` is also marked `noindex` so it won't show up in search engines.

## API surface

| Method | Path | Auth | Purpose |
|---|---|---|---|
| GET | `/api/health` | – | Provider, models, chunk count |
| GET | `/api/documents` | – | List indexed PDFs |
| POST | `/api/documents/upload` | admin | Upload a PDF (multipart `file`) |
| POST | `/api/documents/refresh` | admin | Wipe + re-ingest everything in `DATA_DIR` |
| DELETE | `/api/documents/{filename}` | admin | Remove a single file + its chunks |
| POST | `/api/chat` | – | Body `{messages: [{role, content}]}` → SSE stream |

Interactive docs at `/docs`.

## Deploy on a $6 DigitalOcean droplet

1. Create an Ubuntu 24.04 droplet (basic, $6/mo). SSH in as `root`.
2. Install Docker + git:
   ```bash
   apt-get update && apt-get install -y git nano
   curl -fsSL https://get.docker.com | sh
   ```
3. Clone the repo + configure:
   ```bash
   cd /opt && git clone https://github.com/<you>/<repo>.git phd_bot && cd phd_bot
   cp .env.example .env && nano .env       # fill keys, ADMIN_TOKEN, SITE_ADDRESS
   # For opensource mode with a Groq custom-models JSON:
   cp backend/models.config.example.json backend/models.config.json && nano backend/models.config.json
   ```
4. Point your domain's `A` record at the droplet's public IP (optional — use `SITE_ADDRESS=:80` for IP-only access).
5. Bring it up:
   ```bash
   ./run.sh
   ```
   First run auto-ingests every PDF in `data/`. Caddy fetches a Let's Encrypt cert automatically when a real domain is set in `SITE_ADDRESS`.

> No domain? Set `SITE_ADDRESS=:80` in `.env` and share `http://DROPLET_IP`.

### `run.sh` cheat-sheet

| Command | When to use |
|---|---|
| `./run.sh` | First boot, or routine restart with no PDF / dep changes. |
| `./run.sh up --reingest` | You updated PDFs in `data/` (e.g. after `git pull`) and want vectors rebuilt automatically. |
| `./run.sh up --no-cache` | A dependency changed (`requirements.txt`, `package.json`) — forces a clean image rebuild. |
| `./run.sh up --no-cache --reingest` | Both of the above. Heaviest path. |
| `./run.sh ingest` | Force a refresh against an already-running stack (no container restart). |
| `./run.sh down` | Stop + remove containers. Chroma volume preserved. |
| `./run.sh logs` | Tail logs from all three services. |
| `./run.sh ps` | Show container status. |

### Updates

```bash
cd /opt/phd_bot && git pull && ./run.sh up --reingest    # if PDFs changed
cd /opt/phd_bot && git pull && ./run.sh                  # code-only change
```

The Chroma index lives in the `chroma_data` named volume and survives restarts.

### Admin URL

After deploy, the admin dashboard is at:
```
http(s)://your-host/admin
```
Not linked from the public chat; requires the `ADMIN_TOKEN` from `.env` to perform any action.

## Release workflow (production)

Once the bot is live, we separate dev work from what's deployed using a `production`
branch + tagged releases. Rollback is then two commands.

### Branch / tag layout

| Where | What it holds |
|---|---|
| `main` | Day-to-day development. Push freely; live site is unaffected. |
| `production` | Only stable, deployed releases. Fast-forwarded from `main` per release. |
| Tags `vX.Y.Z` | One per release. The droplet checks out a specific tag or tracks `production`. |
| Droplet | Whatever's checked out there — usually the latest `vX.Y.Z` (via `production`). |

### Cutting a release

When `main` is in a state worth deploying:

```bash
git checkout production
git merge --ff-only main
git tag -a vX.Y.Z -m "vX.Y.Z: <short description>"
git push origin production --tags
```

Versioning follows semver:

- **Patch** (`v1.0.1`): bug fixes, copy tweaks, no behavior change.
- **Minor** (`v1.1.0`): new features that don't break anything.
- **Major** (`v2.0.0`): breaking changes (e.g., requires `.env` edits or a re-ingest).

### Deploying a release to the droplet

The droplet tracks the `production` branch. To pull a freshly cut release:

```bash
cd /opt/phd_bot
git fetch --all --tags
git checkout production       # one-time switch if previously on main
git pull origin production
./run.sh                      # plain redeploy
# or:
./run.sh up --reingest        # if PDFs changed in this release
./run.sh up --no-cache        # if dependencies changed in this release
```

### Rollback (under a minute)

**Quick rollback** — just deploy a previous tag without changing the `production` branch:

```bash
cd /opt/phd_bot
git fetch --tags
git checkout v1.0.0           # any earlier tag; detached HEAD is fine for deploy
./run.sh down && ./run.sh
```

The Chroma index, PDFs, and `.env` are untouched — only the code reverts.

**Permanent rollback** — also move the `production` branch back so the next `git pull production` keeps the rollback:

```bash
# Local
git checkout production
git reset --hard v1.0.0
git push --force-with-lease origin production

# On droplet
git checkout production
git pull origin production
./run.sh
```

### What's deployed where (after each push + deploy)

| Place | Code |
|---|---|
| `main` (your dev branch) | Latest commits — may include unreleased work. |
| `production` | Latest tagged release only. |
| Droplet (live URL) | Whatever's checked out — confirm with `git describe --tags` on the droplet. |

## Quality knobs (`.env`)

| Var | Default | Notes |
|---|---|---|
| `CHUNK_SIZE` | 900 | Smaller = more precise, more chunks. |
| `CHUNK_OVERLAP` | 150 | Keep contiguous context across chunk boundaries. |
| `TOP_K` | 8 | Initial vector retrieval. |
| `RERANK_TOP_K` | 5 | Kept after Jina rerank — fed to the LLM. |
| `USE_RERANKER` | true | Single biggest quality lever in OSS mode. |

## Troubleshooting

- **`ADMIN_TOKEN is not configured`** — you left it as `change-me` (or empty). Set a real
  value in `.env` and restart.
- **`Backend unreachable`** in the UI — confirm `NEXT_PUBLIC_API_URL` (dev) points to the
  FastAPI port and CORS includes the frontend origin.
- **Empty answers / refuses everything** — the index is empty. Click *Refresh index* in
  the sidebar, or POST `/api/documents/refresh`.
- **Provider switch ignored** — only `PROVIDER` matters; you still need a key for the chosen
  provider, otherwise startup fails fast.
