# 🌿 Leaf — Google Maps Lead Generation Platform

Unlimited Google Maps scraping platform with automatic website enrichment. No API keys, no rate limits.

## Features

- **Unlimited scraping** — crawls all pages/results, not just the first page
- **Multi-campaign** — run multiple campaigns in parallel
- **Service × Location matrix** — upload a list of services and locations; every combination gets scraped
- **Email enrichment** — if a website is found but no email, Leaf automatically scrapes the site (contact page, about page, etc.) to find emails
- **Real-time updates** — live WebSocket feed of leads being found
- **CSV export** — export all leads instantly, even mid-scrape
- **Proxy support** — configure per-campaign or globally
- **Modern UI** — dark, clean, fast interface

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Scraper | Go + Chromium (chromedp) — no external APIs |
| Enrichment | Go + Colly |
| Backend | Go 1.22 + Gin + GORM |
| Database | PostgreSQL 16 |
| Frontend | Next.js 14 + Tailwind CSS |
| Real-time | WebSocket |

---

## Quick Start (Docker — recommended)

**Requirements:** Docker + Docker Compose

```bash
# 1. Clone / download the project
git clone <repo> leaf && cd leaf

# 2. Copy env file (optional customization)
cp .env.example .env

# 3. Build & start
docker compose up -d --build

# 4. Open the UI
open http://localhost:3000

# 5. View logs
docker compose logs -f backend
```

The platform is ready at **http://localhost:3000**

---

## Quick Start (Local Development)

**Requirements:** Go 1.22+, Node 20+, PostgreSQL 16, Chrome/Chromium

```bash
# Start PostgreSQL
docker compose up -d postgres

# Backend
cd backend
cp ../.env.example .env
# Edit .env: set DATABASE_URL=postgres://leaf:leafpassword@localhost:5432/leafdb?sslmode=disable
go run main.go

# Frontend (separate terminal)
cd frontend
npm install
NEXT_PUBLIC_API_URL=http://localhost:8080 npm run dev
```

Open http://localhost:3000

---

## Configuration

All settings via environment variables (`.env` or `docker-compose.yml`):

| Variable | Default | Description |
|----------|---------|-------------|
| `DATABASE_URL` | postgres://... | PostgreSQL connection string |
| `PORT` | `8080` | Backend API port |
| `MAX_BROWSERS` | `3` | Max parallel Chrome instances (system-wide) |
| `ENRICHMENT_WORKERS` | `5` | Concurrent website enrichment workers |
| `PROXY_URL` | empty | Global HTTP proxy (`http://user:pass@host:port`) |
| `HEADLESS` | `true` | Run Chrome headless (set `false` to see browser) |
| `CHROME_PATH` | auto | Path to Chrome binary |

---

## How to Use

### 1. Create a Campaign

1. Click **New Campaign**
2. Enter a name
3. Add **Services** (one per line): `plumber`, `electrician`, `dentist`
4. Add **Locations** (one per line): `Warsaw, Poland`, `Krakow, Poland`
5. Set parallel browsers (2–3 recommended for residential IPs)
6. Enable **Website Enrichment** to auto-find emails
7. Optionally set a proxy URL
8. Click **Create Campaign**

### 2. Start Scraping

Click **Start** on the campaign. Leaf will:
- Create one task per (service × location) combination
- Open Chrome, navigate to Google Maps
- Scroll through ALL results (not just page 1)
- Extract: name, category, address, phone, website, rating, reviews, GPS coordinates
- Automatically enrich websites to find email addresses
- Save everything to PostgreSQL in real-time

### 3. Export Leads

Click **Export CSV** at any time. The CSV includes all fields including emails found via enrichment.

---

## Proxy Setup

For high-volume scraping, use rotating proxies:

```bash
# .env
PROXY_URL=http://username:password@proxy.example.com:8080
```

Or per-campaign (enter in the Advanced section when creating a campaign).

Compatible with any HTTP/HTTPS proxy including:
- Bright Data
- Oxylabs
- SmartProxy
- Any residential/datacenter proxy provider

---

## Architecture

```
┌─────────────────┐     ┌──────────────────────────────────────┐
│   Next.js UI    │────▶│           Go Backend (Gin)            │
│  (port 3000)    │◀────│  - REST API                          │
│                 │ WS  │  - WebSocket hub                      │
└─────────────────┘     │  - Worker pool                        │
                         │  - Enrichment workers                 │
                         └────────────┬─────────────────────────┘
                                      │
                         ┌────────────▼─────────────────────────┐
                         │          Chromium (chromedp)          │
                         │  - Headless browser per task          │
                         │  - Google Maps scraping               │
                         └────────────┬─────────────────────────┘
                                      │
                         ┌────────────▼─────────────────────────┐
                         │        Colly (enrichment)             │
                         │  - Website scraping                   │
                         │  - Email extraction                   │
                         └────────────┬─────────────────────────┘
                                      │
                         ┌────────────▼─────────────────────────┐
                         │          PostgreSQL                    │
                         │  campaigns, tasks, leads              │
                         └──────────────────────────────────────┘
```

---

## Tips

- **Specificity**: Use specific service names (`dentist` works better than `doctor`)
- **Locations**: Include country for accuracy (`Warsaw, Poland` not just `Warsaw`)
- **Concurrency**: Keep at 2–3 for residential IPs, up to 5 for datacenter/proxy
- **Enrichment**: Runs automatically in background, no action needed
- **Large campaigns**: 10 services × 50 locations = 500 tasks, can find 10,000+ leads
