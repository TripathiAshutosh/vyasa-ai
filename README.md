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

## Quick start — local dev

You'll need: Python 3.11+, Node 20+, and either an OpenAI key or (Groq + Jina) keys.

### 1. Backend

```bash
cd backend
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env          # fill in OPENAI_API_KEY (or GROQ + JINA), and ADMIN_TOKEN
export DATA_DIR=../data       # so it sees your PDFs
export CHROMA_DIR=./chroma_db
uvicorn app.main:app --reload --port 8000
```

Then in another shell, populate the index for the first time:

```bash
curl -X POST http://localhost:8000/api/documents/refresh \
     -H "X-Admin-Token: $(grep ^ADMIN_TOKEN backend/.env | cut -d= -f2)"
```

### 2. Frontend

```bash
cd frontend
cp .env.local.example .env.local   # NEXT_PUBLIC_API_URL=http://localhost:8000
npm install
npm run dev
```

Open <http://localhost:3000>.

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

1. Create an Ubuntu 22.04 droplet (basic, $6/mo). SSH in as `root`.
2. Install Docker + compose plugin:
   ```bash
   curl -fsSL https://get.docker.com | sh
   ```
3. Clone the repo + configure:
   ```bash
   git clone <your-repo-url> phd_bot && cd phd_bot
   cp .env.example .env && nano .env       # fill keys, set SITE_ADDRESS=yourdomain.com
   mkdir -p data && cp /path/to/*.pdf data/
   ```
4. Point your domain's `A` record at the droplet's public IP.
5. Bring it up:
   ```bash
   docker compose up -d --build
   ```
   Caddy will fetch a Let's Encrypt certificate automatically (assumes ports 80/443 are open).
6. Trigger the first index build:
   ```bash
   curl -X POST https://yourdomain.com/api/documents/refresh \
        -H "X-Admin-Token: <ADMIN_TOKEN from .env>"
   ```

> No domain? Set `SITE_ADDRESS=:80` in `.env` and access the droplet's IP over plain HTTP.

### Updates

```bash
git pull && docker compose up -d --build
```

The Chroma index lives in the `chroma_data` named volume and survives restarts.

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
