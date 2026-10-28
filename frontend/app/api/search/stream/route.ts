import { NextRequest } from 'next/server'
import { normalizeRecord, matchesQuery, getIdentityKey } from '@/lib/search'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const BACKEND_BASE = process.env.BACKEND_API_URL || process.env.NEXT_PUBLIC_API_URL || 'http://127.0.0.1:8001'
const DUPLICATE_CAP = 2

let lastBackendCheck = 0
let isBackendAlive = false

async function checkBackendAlive(): Promise<boolean> {
  const now = Date.now()
  if (now - lastBackendCheck < 15000) {
    return isBackendAlive
  }
  lastBackendCheck = now
  try {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 2500)
    const res = await fetch(`${BACKEND_BASE.replace(/\/$/, '')}/health`, {
      signal: controller.signal,
      headers: { Accept: 'application/json' },
      cache: 'no-store',
    })
    clearTimeout(timeout)
    isBackendAlive = res.ok
  } catch {
    isBackendAlive = false
  }
  return isBackendAlive
}

async function tryBackendStream(req: NextRequest, q: string, limit: string, offset: string, field: string, maxScan: string, dataset: string) {
  const alive = await checkBackendAlive()
  if (!alive) return null

  try {
    const url = new URL(`${BACKEND_BASE.replace(/\/$/, '')}/search/stream`)
    url.searchParams.set('q', q)
    url.searchParams.set('limit', limit)
    url.searchParams.set('offset', offset)
    url.searchParams.set('field', field)
    url.searchParams.set('dataset', dataset)
    url.searchParams.set('max_scan', maxScan)

    const res = await fetch(url.toString(), {
      headers: { Accept: 'text/event-stream' },
    })

    if (res.ok && res.body) {
      return new Response(res.body, {
        headers: {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache, no-transform',
          'Connection': 'keep-alive',
          'X-Accel-Buffering': 'no',
        },
      })
    }
  } catch {
    isBackendAlive = false
  }
  return null
}

// ─── Dataset Registry ───
interface DatasetDef {
  repo: string
  source: string
  rows: number
}

const DATASETS: Record<string, DatasetDef> = {
  duplicate:    { repo: 'Hfzune/Duplicate-mix',               source: 'Duplicate-mix',    rows: 5009587740 },
  shatterme:    { repo: 'shatterme/shatterme-truecaller',     source: 'Truecaller 2.5B',  rows: 2504793870 },
  phonebook:    { repo: 'znox2942/phonebook',                 source: 'Phonebook',        rows: 1726699242 },
  hitecknuminfo:{ repo: 'HiTeckGroup/HiTeckNuMinfo',          source: 'HiTeckNuMinfo',    rows: 1782434387 },
  truecaller:   { repo: 'ishdatt/Truecaller285m',             source: 'Truecaller 285M',  rows: 285000000  },
  telegram:     { repo: 'parthislive/TELEGRAM',               source: 'Telegram',         rows: 105472837  },
  paytm:        { repo: 'Zerotracelegit/paytm',               source: 'Paytm',            rows: 7345462    },
  flipkart:     { repo: 'HiTeckGroup/Flipkart',               source: 'Flipkart',         rows: 3810780    },
  hiteckgroup:  { repo: 'HiTeckGroup/HiTeckGroup',            source: 'HiTeckGroup',      rows: 106833     },
}

const TOTAL_ALL_ROWS = Object.values(DATASETS).reduce((s, d) => s + d.rows, 0)

function getActiveDatasets(choice: string): DatasetDef[] {
  if (choice === 'all') return Object.values(DATASETS)
  const ds = DATASETS[choice]
  return ds ? [ds] : Object.values(DATASETS)
}

function getHeaders(): Record<string, string> {
  const headers: Record<string, string> = { Accept: 'application/json' }
  if (process.env.HF_TOKEN) {
    headers['Authorization'] = `Bearer ${process.env.HF_TOKEN}`
  }
  return headers
}

/**
 * Use HF /filter endpoint for exact-match lookups (phone, aadhaar).
 * This is O(1) — a single API call returns matching rows via DuckDB on HF's side.
 */
async function filterDataset(
  repo: string,
  whereClause: string,
  length = 20,
  retries = 3,
): Promise<any[]> {
  const baseUrl = `https://datasets-server.huggingface.co/filter`
  const params = new URLSearchParams({
    dataset: repo,
    config: 'default',
    split: 'train',
    where: whereClause,
    offset: '0',
    length: String(length),
  })

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(`${baseUrl}?${params}`, {
        headers: getHeaders(),
        cache: 'no-store',
      })
      if (res.status === 429 && attempt < retries) {
        await new Promise(r => setTimeout(r, 1000 * Math.pow(2, attempt)))
        continue
      }
      if (!res.ok) return []
      const data = await res.json()
      return data.rows || []
    } catch {
      if (attempt < retries) {
        await new Promise(r => setTimeout(r, 500 * (attempt + 1)))
        continue
      }
      return []
    }
  }
  return []
}

/**
 * Use HF /search endpoint for full-text search (name, address, etc.).
 * Uses DuckDB + BM25 on HF's side — single API call.
 */
async function searchDataset(
  repo: string,
  query: string,
  length = 20,
  retries = 3,
): Promise<any[]> {
  const baseUrl = `https://datasets-server.huggingface.co/search`
  const params = new URLSearchParams({
    dataset: repo,
    config: 'default',
    split: 'train',
    query: query,
    offset: '0',
    length: String(length),
  })

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(`${baseUrl}?${params}`, {
        headers: getHeaders(),
        cache: 'no-store',
      })
      if (res.status === 429 && attempt < retries) {
        await new Promise(r => setTimeout(r, 1000 * Math.pow(2, attempt)))
        continue
      }
      if (!res.ok) return []
      const data = await res.json()
      return data.rows || []
    } catch {
      if (attempt < retries) {
        await new Promise(r => setTimeout(r, 500 * (attempt + 1)))
        continue
      }
      return []
    }
  }
  return []
}

/**
 * Detect which phone column names a dataset likely uses, and build
 * a WHERE clause that covers all variants.
 */
function buildPhoneWhere(digits: string, repo: string): string {
  const escaped = digits.replace(/'/g, "''")
  // Different datasets use different column names
  const r = repo.toLowerCase()
  if (r.includes('truecaller') || r.includes('ishdatt')) {
    return `"Number"='${escaped}' OR "phoneNumber"='${escaped}'`
  }
  if (r.includes('telegram')) {
    return `"phone"='${escaped}' OR "phoneNumber"='${escaped}'`
  }
  if (r.includes('phonebook') || r.includes('numinfo')) {
    return `"number"='${escaped}' OR "phoneNumber"='${escaped}' OR "phone"='${escaped}'`
  }
  if (r.includes('flipkart')) {
    return `"CustomerPhone"='${escaped}' OR "phoneNumber"='${escaped}'`
  }
  if (r.includes('paytm')) {
    return `"mobile"='${escaped}' OR "phoneNumber"='${escaped}'`
  }
  // Default — Duplicate-mix and others
  return `"phoneNumber"='${escaped}'`
}

function buildAadharWhere(digits: string): string {
  const escaped = digits.replace(/'/g, "''")
  return `"aadharNumber"='${escaped}'`
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const q = searchParams.get('q')?.trim() || ''
  const limit = Math.min(100, Math.max(1, parseInt(searchParams.get('limit') || '10', 10)))
  const offset = Math.max(0, parseInt(searchParams.get('offset') || '0', 10))
  const field = searchParams.get('field') || 'auto'
  const datasetChoice = searchParams.get('dataset') || 'all'
  const maxScan = Math.min(100000, Math.max(100, parseInt(searchParams.get('max_scan') || '10000', 10)))

  if (!q) {
    return new Response('event: error\ndata: {"detail": "Query parameter q is required"}\n\n', {
      headers: { 'Content-Type': 'text/event-stream' },
    })
  }

  // 1. Try external Python DuckDB backend first if running
  const backendResponse = await tryBackendStream(req, q, String(limit), String(offset), field, String(maxScan), datasetChoice)
  if (backendResponse) {
    return backendResponse
  }

  // 2. Smart search using HF /filter and /search endpoints
  const encoder = new TextEncoder()
  const stream = new ReadableStream({
    async start(controller) {
      const t0 = Date.now()

      const sendEvent = (event: string, data: unknown) => {
        const text = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`
        controller.enqueue(encoder.encode(text))
      }

      const activeDatasets = getActiveDatasets(datasetChoice)
      const datasetNames = activeDatasets.map(d => d.source).join(' + ')

      // Detect query type
      const digits = q.replace(/\D/g, '')
      const isPhone = (field === 'phone') || (field === 'auto' && digits.length === 10 && /^[6-9]/.test(digits))
      const isAadhar = (field === 'aadhar' || field === 'aadhaar') || (field === 'auto' && digits.length === 12)
      const isFilter = isPhone || isAadhar
      const searchMode = isPhone ? 'phone' : isAadhar ? 'aadhaar' : 'text'

      sendEvent('progress', {
        scanned: 0,
        matches: 0,
        wave: 1,
        elapsed: 0.0,
        status: `Searching ${datasetNames} (${searchMode} lookup)...`,
      })

      const seen: Record<string, number> = {}
      let matchCount = 0
      let scannedTotal = 0

      try {
        // Query datasets sequentially to avoid rate limits, but use efficient endpoints
        for (let i = 0; i < activeDatasets.length && matchCount < limit; i++) {
          const ds = activeDatasets[i]

          let rows: any[] = []
          try {
            if (isFilter) {
              // Use /filter for exact phone/aadhaar match — single indexed query
              const whereClause = isPhone
                ? buildPhoneWhere(digits.length >= 10 ? digits.slice(-10) : digits, ds.repo)
                : buildAadharWhere(digits.slice(-12))

              rows = await filterDataset(ds.repo, whereClause, limit * 2)
            } else {
              // Use /search for full-text search (name, address, etc.)
              rows = await searchDataset(ds.repo, q, limit * 2)
            }
          } catch (err) {
            // Skip this dataset on error, continue to others
            console.error(`Error querying ${ds.source}:`, err)
          }

          scannedTotal += rows.length || 0

          for (const item of rows) {
            const raw = item.row || {}
            const normalized = normalizeRecord(raw, item.row_idx ?? 0, ds.source)

            // For filter mode, results are already matched by the API
            // For search mode, HF's BM25 already ranked them, but do a client-side check too
            const isRelevant = isFilter || matchesQuery(normalized, q, field)

            if (isRelevant) {
              const ident = getIdentityKey(normalized)
              const count = seen[ident] || 0
              if (count < DUPLICATE_CAP) {
                seen[ident] = count + 1
                matchCount++
                sendEvent('match', normalized)
                if (matchCount >= limit) break
              }
            }
          }

          const elapsed = Number(((Date.now() - t0) / 1000).toFixed(2))
          sendEvent('progress', {
            scanned: scannedTotal,
            matches: matchCount,
            wave: i + 2,
            elapsed,
            status: matchCount >= limit
              ? 'Matches found'
              : `Searched ${ds.source} (${matchCount} match${matchCount !== 1 ? 'es' : ''})...`,
          })

          // Small delay between datasets to be respectful of rate limits
          if (i < activeDatasets.length - 1 && matchCount < limit) {
            await new Promise(r => setTimeout(r, 100))
          }
        }

        const totalElapsed = Number(((Date.now() - t0) / 1000).toFixed(2))
        sendEvent('progress', {
          scanned: scannedTotal,
          matches: matchCount,
          wave: activeDatasets.length + 1,
          elapsed: totalElapsed,
          status: 'Done',
        })
        sendEvent('done', {
          scanned: scannedTotal,
          matches: matchCount,
          elapsed: totalElapsed,
        })
      } catch (err: unknown) {
        const errorMsg = err instanceof Error ? err.message : 'Unknown query error'
        sendEvent('error', { detail: errorMsg })
      } finally {
        controller.close()
      }
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  })
}
