import { NextRequest, NextResponse } from 'next/server'
import { normalizeRecord, matchesQuery, getIdentityKey, SearchRecord } from '@/lib/search'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const BACKEND_BASE = process.env.BACKEND_API_URL || process.env.NEXT_PUBLIC_API_URL || 'http://127.0.0.1:8001'
const DUPLICATE_CAP = 2

// Cache backend health check for 15 seconds to avoid connection timeouts
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

function buildPhoneWhere(digits: string, repo: string): string {
  const escaped = digits.replace(/'/g, "''")
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
    return NextResponse.json({ error: 'Query parameter q is required' }, { status: 400 })
  }

  const t0 = Date.now()

  // 1. Check if external / Python DuckDB backend is running
  const backendAvailable = await checkBackendAlive()
  if (backendAvailable) {
    try {
      const url = new URL(`${BACKEND_BASE.replace(/\/$/, '')}/search`)
      url.searchParams.set('q', q)
      url.searchParams.set('limit', String(limit))
      url.searchParams.set('offset', String(offset))
      url.searchParams.set('field', field)
      url.searchParams.set('dataset', datasetChoice)
      url.searchParams.set('max_scan', String(maxScan))

      const res = await fetch(url.toString(), {
        headers: { Accept: 'application/json' },
      })
      if (res.ok) {
        const data = await res.json()
        if (data && data.results && data.results.length > 0) {
          return NextResponse.json(data)
        }
      }
    } catch {
      // Backend failed during call, fallback below
    }
  }

  // 2. Smart search using HF /filter and /search endpoints
  const digits = q.replace(/\D/g, '')
  const isPhone = (field === 'phone') || (field === 'auto' && digits.length === 10 && /^[6-9]/.test(digits))
  const isAadhar = (field === 'aadhar' || field === 'aadhaar') || (field === 'auto' && digits.length === 12)
  const isFilter = isPhone || isAadhar

  const results: SearchRecord[] = []
  const seen: Record<string, number> = {}
  let scannedTotal = 0
  const activeDatasets = getActiveDatasets(datasetChoice)

  for (const ds of activeDatasets) {
    if (results.length >= limit) break

    let rows: any[] = []
    try {
      if (isFilter) {
        const whereClause = isPhone
          ? buildPhoneWhere(digits.length >= 10 ? digits.slice(-10) : digits, ds.repo)
          : buildAadharWhere(digits.slice(-12))
        rows = await filterDataset(ds.repo, whereClause, limit * 2)
      } else {
        rows = await searchDataset(ds.repo, q, limit * 2)
      }
    } catch {
      continue
    }

    scannedTotal += rows.length || 0

    for (const item of rows) {
      const raw = item.row || {}
      const normalized = normalizeRecord(raw, item.row_idx ?? 0, ds.source)

      const isRelevant = isFilter || matchesQuery(normalized, q, field)
      if (isRelevant) {
        const ident = getIdentityKey(normalized)
        const count = seen[ident] || 0
        if (count < DUPLICATE_CAP) {
          seen[ident] = count + 1
          results.push(normalized)
          if (results.length >= limit) break
        }
      }
    }

    // Small delay between datasets
    if (results.length < limit) {
      await new Promise(r => setTimeout(r, 100))
    }
  }

  const elapsed = Number(((Date.now() - t0) / 1000).toFixed(4))

  return NextResponse.json({
    query: q,
    total_matches: results.length,
    page: Math.floor(offset / limit) + 1,
    limit,
    offset,
    scanned_rows: scannedTotal,
    results,
    elapsed,
  })
}
