# Handover — Vyasa AI Assistant

This document is the single page the IT team should read before deploying. It is split into a non-technical summary, a "who does what" section, and a precise deployment runbook.

If anything in here is unclear, the developer (contact at the bottom) is happy to do a 30-minute call.

---

## What this is, in one paragraph

Vyasa AI Assistant is a Q&A chatbot for PhD admission queries for **Chhatrapati Shahu Ji Maharaj University, Kanpur** (admission session 2026–27). Applicants ask questions in natural language; the bot answers using **only** the official PDF documents you provide, and cites the source page for every answer. It is a self-contained web application — a single URL is all that is exposed to users. The university's existing website can either link to that URL or embed it in an `<iframe>`. There is also a hidden `/admin` page where authorised staff can upload or update the source PDFs.

---

## What you'll need

| Resource | Requirement | Notes |
|---|---|---|
| Server | Linux VM, **2 GB RAM, 1 vCPU, 25 GB disk** | Ubuntu 22.04 or 24.04 LTS preferred. A $6 DigitalOcean droplet works; so does any small VM the university owns. |
| Domain / subdomain | One subdomain, e.g. `vyasa.csjmu.ac.in` | Single `A` record pointing at the server's public IP. HTTPS is set up automatically by the app. |
| Ports | **80 and 443 inbound** from the internet, **22 inbound** restricted to admin IPs | Caddy (bundled) auto-provisions a Let's Encrypt TLS certificate. |
| Outbound network | The server must reach `api.groq.com`, `api.jina.ai`, and (optionally) `api.openai.com` | All over HTTPS / port 443. No special firewall holes needed beyond standard egress. |
| API keys (provided separately) | Groq + Jina (default) **or** OpenAI | Costs typically under ₹1,000/month at modest traffic; free tiers cover testing. |

> The application has **no database** of its own beyond a small on-disk vector index (~50 MB for a few PDFs). No SQL server, no Redis, nothing else to provision.

---

## Who does what (handover boundary)

| Task | Owner |
|---|---|
| Provision and maintain the server / VM | **IT team** |
| DNS, TLS (auto via Caddy), firewall, OS patching | **IT team** |
| Deploy and start the application | **IT team** (one-time, ~30 min) |
| Upload new PDFs / refresh the index each admission cycle | **IT team** (5 minutes via `/admin` page) |
| Monitor uptime, restart on failure | **IT team** |
| Code changes, RAG tuning, model swaps, new features | **Developer** (contact below) |
| Major version upgrades, dependency updates | **Developer**, deployed by **IT team** |
| Security incidents involving the application | **IT team + Developer**, jointly |

Updates from the developer arrive as `git push` to the repo. IT pulls and runs `./run.sh` on the server — full instructions in the *Updates* section below.

---

## One-time deployment (~30 minutes)

These commands run on the server, as `root` or via `sudo`.

### 1. Install Docker and Git
```bash
apt-get update && apt-get install -y git nano curl
curl -fsSL https://get.docker.com | sh
```

### 2. Clone the repository
```bash
mkdir -p /opt && cd /opt
git clone https://github.com/TripathiAshutosh/vyasa-ai.git phd_bot
cd phd_bot
git config credential.helper store      # so future `git pull` doesn't prompt
```

If prompted for credentials on the clone, use the GitHub username + Personal Access Token shared by the developer.

### 3. Configure environment

Copy the template and fill in the four values the developer will share with you (provider choice, API keys, admin token, domain name):

```bash
cp .env.example .env
nano .env
```

Set these:
```
PROVIDER=opensource              # or "openai" — developer will advise
GROQ_API_KEY=<provided>          # if opensource
JINA_API_KEY=<provided>          # if opensource (embeddings + reranker)
OPENAI_API_KEY=<provided>        # if openai
ADMIN_TOKEN=<pick a strong random string — e.g. `openssl rand -hex 24`>
SITE_ADDRESS=vyasa.csjmu.ac.in   # the subdomain you've provisioned
HTTP_PORT=80
HTTPS_PORT=443
```

If using a custom Groq model configuration:
```bash
cp backend/models.config.example.json backend/models.config.json
nano backend/models.config.json
```

### 4. Put the source PDFs in place

The repository already contains the initial PDFs in `data/`. To start fresh, replace them:
```bash
rm -f data/*.pdf
# Copy your PDFs into data/ via scp, sftp, or paste through nano.
```

Alternatively, you can skip this step and upload PDFs via the `/admin` web page after the service is up — that's the recommended flow once the system is running.

### 5. Start the application
```bash
./run.sh
```

First run takes 3–5 minutes (it builds two container images, starts them, and ingests the PDFs). When the script finishes you'll see:

```
OK   : All up.
       App:         http://localhost:80
       API health:  http://localhost:80/api/health
```

### 6. Verify

From your laptop or any machine:
- Open `https://vyasa.csjmu.ac.in/` — chat interface should load with the CSJM university banner at the top.
- Open `https://vyasa.csjmu.ac.in/api/health` — should return JSON with `"status":"ok"` and a chunk count.
- Open `https://vyasa.csjmu.ac.in/admin` — admin dashboard. Click *Upload PDFs* once and you'll be prompted for the `ADMIN_TOKEN` you set in step 3.

If the cert doesn't appear immediately, give it 60 seconds — Caddy fetches it on first HTTPS request.

---

## Integration with the university website

Pick **one** of these for the admissions page; they're listed cheapest-to-deepest:

**A. Link button (recommended for launch):**
```html
<a href="https://vyasa.csjmu.ac.in/" target="_blank" rel="noopener"
   style="display:inline-block;padding:12px 20px;background:#0f3a82;color:white;
          border-radius:8px;text-decoration:none;font-weight:600;">
  🎓 Ask our AI Assistant about PhD Admissions
</a>
```

**B. Inline iframe embed:**
```html
<iframe src="https://vyasa.csjmu.ac.in/"
        style="width:100%; height:720px; border:0; border-radius:12px;"
        title="PhD Admission Assistant"></iframe>
```

**C. Floating chat widget on every page** — talk to the developer; this is a small JS snippet but needs site-wide rollout.

---

## Day-to-day operations

### Updating the source PDFs (each admission cycle, or whenever a notification changes)

The easiest way: open `https://vyasa.csjmu.ac.in/admin`, paste your admin token if prompted, drag-and-drop the new PDFs (multi-select supported), click *Refresh index* if you've removed any old ones. Done in 60 seconds, no server access needed.

### Pulling code updates from the developer

```bash
cd /opt/phd_bot
git pull
./run.sh                          # if only code changed
./run.sh up --reingest            # if PDFs were updated in the repo
./run.sh up --no-cache            # if dependencies changed (developer will say so)
```

### Common operational commands
```bash
./run.sh logs       # live logs from all services
./run.sh ps         # container status
./run.sh down       # stop everything (vector index is preserved)
./run.sh            # start again
```

### Backups (recommended monthly)
```bash
docker run --rm \
  -v phd_bot_chroma_data:/d -v $(pwd):/b alpine \
  tar czf /b/chroma-backup-$(date +%F).tar.gz /d
```
Stash the resulting `.tar.gz` somewhere off the server.

### Monitoring (optional, free)
Sign up for [UptimeRobot](https://uptimerobot.com) (free tier), have it ping `https://vyasa.csjmu.ac.in/api/health` every 5 minutes. It will email/SMS if the service becomes unreachable.

---

## When to call the developer back

| Situation | Action |
|---|---|
| Service is down and `./run.sh logs` doesn't show an obvious cause | Email the developer with the last 100 log lines. |
| API keys need rotation or have hit quota limits | IT can rotate locally (edit `.env`, restart). Loop in the developer if quotas need raising. |
| Want to change the model, embeddings, or RAG behaviour | Developer change — opens a PR, IT pulls + redeploys. |
| Want to add new features (multi-language, voice input, etc.) | Developer change. |
| Answer quality issues / hallucinations / wrong citations | Email the developer the question + the answer; we can tune retrieval. |
| Security incident (compromised key, suspicious activity) | Rotate the affected key immediately, then loop in the developer. |

---

## Contact

**Developer:** Ashutosh Tripathi  
**GitHub:** [@TripathiAshutosh](https://github.com/TripathiAshutosh)  
**Email:** tripathiashutosh019@gmail.com

For the four secrets you'll need (`GROQ_API_KEY`, `JINA_API_KEY` or `OPENAI_API_KEY`, the GitHub Personal Access Token, and a suggested initial `ADMIN_TOKEN`), please email the developer — these are shared out-of-band, not over this document.

---

*Detailed technical reference, architecture diagrams, and configuration knobs are in `README.md` in the repository root.*
