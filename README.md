# WHO?gle Dataset Search Engine & Web UI

A fast, modern Google-style search engine and web application for searching records across Hugging Face datasets ([`Hfzune/Duplicate-mix`](https://huggingface.co/datasets/Hfzune/Duplicate-mix) / ICMR + HiTek).

Designed for **instant deployment to Netlify, Vercel, or local use** with **zero setup and zero local disk consumption**.

---

## Architecture Overview

```
┌────────────────────────────────────────────────────────┐
│               WHO?gle Web UI (Next.js)                 │
│  - Google SERP layout & multi-colored branding         │
│  - Real-time SSE streaming search                      │
│  - Phone, Aadhaar, Name, and District detection        │
│  - Expandable record drawers & JSON copy button        │
│  - Zero configuration required                         │
└───────────────────────────┬────────────────────────────┘
                            │ /api/search/stream
                            ▼
┌────────────────────────────────────────────────────────┐
│         Next.js Fullstack Serverless API Route         │
│  - Direct live querying from Hugging Face Datasets API │
│  - Automatic failover / proxy to Python DuckDB backend │
│  - Null byte cleanup (\x00), phone/aadhaar extraction  │
│  - Real-time Server-Sent Events (SSE) streaming        │
└───────────────────────────┬────────────────────────────┘
                            │ HTTPS Range / Datasets API
                            ▼
┌────────────────────────────────────────────────────────┐
│       Hugging Face: Hfzune/Duplicate-mix Dataset       │
└────────────────────────────────────────────────────────┘
```

---

## Deploy Online (Vercel & Netlify)

### Deploy to Vercel
1. Push this repository to GitHub or GitLab.
2. In [Vercel](https://vercel.com/), click **Add New Project** and import the repository.
3. If deploying from the repository root:
   - Root Directory: `frontend` (or leave default with the included `vercel.json`)
   - Framework: **Next.js**
4. Click **Deploy**! It works out-of-the-box with no environment variables required.

### Deploy to Netlify
1. Connect your repository in [Netlify](https://www.netlify.com/).
2. The included `netlify.toml` automatically configures the Next.js build.
3. Click **Deploy site**.

---

## Local Development

### 1. Run Next.js Frontend
```bash
cd frontend
pnpm install
pnpm dev
```
Open **[http://localhost:3000](http://localhost:3000)** in your browser. Searches will work immediately via the built-in `/api/search/stream` serverless route!

### 2. (Optional) Run with Python DuckDB Turbo Backend
If you want to run the high-performance local DuckDB engine alongside Next.js:
```bash
pip install -r requirements.txt
uvicorn main:app --host 127.0.0.1 --port 8001 --reload
```
The Next.js API automatically detects if the Python backend is active and routes high-speed queries to it!

---

## API Endpoints

- `GET /api/search/stream?q={query}&field={field}&max_scan={scan}` — Real-time SSE stream with progress and matches
- `GET /api/search?q={query}&limit=10&offset=0` — Standard JSON search response
