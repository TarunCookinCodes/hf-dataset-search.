'use client'

import { useState, useRef, useCallback } from 'react'
import { Database, Search, X, ChevronDown, Loader2, Copy, Check, Sparkles } from 'lucide-react'

type Result = Record<string, unknown>

type Progress = {
  scanned: number
  matches: number
  wave: number
  elapsed: number
  status: string
}

/** Build a fake "url" breadcrumb from row data for the Google SERP look */
function buildBreadcrumb(row: Result): string {
  const src = String(row.source || '').toLowerCase()
  let dsName = 'Records'
  if (src.includes('shatterme') || src.includes('truecaller 2.5b')) dsName = 'TruecallerGlobal'
  else if (src.includes('truecaller')) dsName = 'Truecaller'
  else if (src.includes('telegram')) dsName = 'Telegram'
  else if (src.includes('phonebook')) dsName = 'Phonebook'
  else if (src.includes('numinfo') || src.includes('hitecknuminfo')) dsName = 'HiTeckNuMinfo'
  else if (src.includes('flipkart')) dsName = 'Flipkart'
  else if (src.includes('hiteckgroup')) dsName = 'HiTeckGroup'
  else if (src.includes('paytm')) dsName = 'Paytm'
  const parts = ['whoogle.org', 'records', dsName]
  const district = row.district ? String(row.district).toLowerCase().replace(/\s+/g, '-') : null
  const state = row.state ? String(row.state).toLowerCase().replace(/\s+/g, '-') : null
  if (state) parts.push(state)
  if (district && district !== state) parts.push(district)
  if (row.carrier) parts.push(String(row.carrier).toLowerCase().replace(/\s+/g, '-'))
  parts.push(`rec-${row.row_idx ?? row.id ?? '0'}`)
  return parts.join(' › ')
}

/** Build a snippet from the row's data fields */
function buildSnippet(row: Result): string {
  const pieces: string[] = []
  if (row.username) pieces.push(`Username: @${row.username}`)
  if (row.userId) pieces.push(`User ID: ${row.userId}`)
  if (row.fathersName) pieces.push(`Father: ${row.fathersName}`)
  if (row.phone || row.phoneNumber) pieces.push(`Phone: ${row.phone ?? row.phoneNumber}`)
  if (row.carrier) pieces.push(`Carrier: ${row.carrier}`)
  if (row.gender && String(row.gender).toUpperCase() !== 'UNKNOWN') pieces.push(`Gender: ${row.gender}`)
  if (row.otherNumber) pieces.push(`Alt: ${row.otherNumber}`)
  if (row.aadhar || row.aadharNumber) pieces.push(`Aadhaar: ${row.aadhar ?? row.aadharNumber}`)
  if (row.email) pieces.push(`Email: ${row.email}`)
  if (row.bank) pieces.push(`Bank: ${row.bank}`)
  if (row.pan) pieces.push(`PAN: ${row.pan}`)
  if (row.dob) pieces.push(`DOB: ${row.dob}`)
  if (row.income) pieces.push(`Income: ${row.income}`)
  if (row.address) pieces.push(`Address: ${String(row.address).slice(0, 120)}`)
  if (row.pincode) pieces.push(`PIN: ${row.pincode}`)
  if (row.source) pieces.push(`Source: ${row.source}`)
  return pieces.join(' · ') || 'No additional details available for this record.'
}

/** Build a title from the row */
function buildTitle(row: Result): string {
  let name = row.name ? String(row.name) : ''
  if (!name && row.username) {
    name = `@${row.username}`
  } else if (!name) {
    name = 'Record Details'
  }
  const loc: string[] = []
  if (row.town) loc.push(String(row.town))
  if (row.district) loc.push(String(row.district))
  if (row.state) loc.push(String(row.state))
  if (loc.length === 0 && row.country && String(row.country).toLowerCase() !== 'unknown') {
    loc.push(String(row.country))
  }
  const locStr = loc.length > 0 ? ` — ${loc.join(', ')}` : ''
  return `${name}${locStr}`
}

/** App logo component for search result cards */
function SourceAppLogo({ source, className = '' }: { source?: unknown; className?: string }) {
  const s = String(source || '').toLowerCase()

  // Telegram logo
  if (s.includes('telegram')) {
    return (
      <div
        className={`flex size-[26px] items-center justify-center rounded-full bg-[#229ED9] shadow-sm shrink-0 ${className}`}
        title="Telegram"
      >
        <svg viewBox="0 0 24 24" className="size-3.5 fill-white" style={{ transform: 'translateX(-0.5px) translateY(0.5px)' }}>
          <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm4.64 6.8c-.15 1.58-.8 5.42-1.13 7.19-.14.75-.42 1-.68 1.03-.58.05-1.02-.38-1.58-.75-.88-.58-1.38-.94-2.23-1.5-.99-.65-.35-1.01.22-1.59.15-.15 2.71-2.48 2.76-2.69a.2.2 0 00-.05-.18c-.06-.05-.14-.03-.21-.02-.09.02-1.49.95-4.22 2.79-.4.27-.76.41-1.08.4-.36-.01-1.04-.2-1.55-.37-.63-.2-1.12-.31-1.08-.66.02-.18.27-.36.75-.55 2.92-1.27 4.86-2.11 5.83-2.51 2.78-1.16 3.35-1.36 3.73-1.36.08 0 .27.02.39.12.1.08.13.19.14.27-.01.06.01.24 0 .38z"/>
        </svg>
      </div>
    )
  }

  // Truecaller logo
  if (s.includes('truecaller')) {
    return (
      <div
        className={`flex size-[26px] items-center justify-center rounded-full bg-[#0087FF] shadow-sm shrink-0 ${className}`}
        title="Truecaller"
      >
        <svg viewBox="0 0 24 24" className="size-3.5 fill-white">
          <path d="M20.01 15.38c-1.23 0-2.42-.2-3.53-.56a.977.977 0 00-1.01.24l-2.2 2.2a15.053 15.053 0 01-6.59-6.59l2.2-2.21a.96.96 0 00.25-1.01A11.36 11.36 0 018.57 3.9c0-.55-.45-1-1-1H4c-.55 0-1 .45-1 1 0 9.39 7.61 17 17 17 .55 0 1-.45 1-1v-3.52c0-.55-.45-1-.99-1z"/>
        </svg>
      </div>
    )
  }

  // Paytm logo
  if (s.includes('paytm')) {
    return (
      <div
        className={`flex size-[26px] items-center justify-center rounded-full bg-[#002E6E] shadow-sm shrink-0 leading-none select-none ${className}`}
        title="Paytm"
      >
        <span className="text-[8px] font-black tracking-tight"><span className="text-[#00BAF2]">pay</span><span className="text-white">tm</span></span>
      </div>
    )
  }

  // Flipkart logo
  if (s.includes('flipkart')) {
    return (
      <div
        className={`flex size-[26px] items-center justify-center rounded-full bg-[#2874F0] shadow-sm shrink-0 leading-none select-none ${className}`}
        title="Flipkart"
      >
        <span className="text-[13px] font-black italic text-[#FFE500] font-serif">f</span>
      </div>
    )
  }

  // Phonebook logo
  if (s.includes('phonebook')) {
    return (
      <div
        className={`flex size-[26px] items-center justify-center rounded-full bg-[#059669] shadow-sm shrink-0 ${className}`}
        title="Phonebook"
      >
        <svg viewBox="0 0 24 24" className="size-3.5 fill-none stroke-white stroke-[2.2] stroke-linecap-round stroke-linejoin-round">
          <path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1-2.5-2.5Z"/>
          <path d="M8 7h8"/>
          <path d="M8 11h8"/>
          <path d="M2 7h2"/>
          <path d="M2 11h2"/>
          <path d="M2 15h2"/>
        </svg>
      </div>
    )
  }

  // HiTeckNuMinfo
  if (s.includes('numinfo') || s.includes('hitecknuminfo')) {
    return (
      <div
        className={`flex size-[26px] items-center justify-center rounded-full bg-[#4F46E5] shadow-sm shrink-0 text-white font-bold text-[8.5px] select-none ${className}`}
        title="HiTeck NuMinfo"
      >
        <span>NUM</span>
      </div>
    )
  }

  // HiTeckGroup
  if (s.includes('hiteckgroup')) {
    return (
      <div
        className={`flex size-[26px] items-center justify-center rounded-full bg-[#7C3AED] shadow-sm shrink-0 text-white font-bold text-[8.5px] select-none ${className}`}
        title="HiTeckGroup"
      >
        <span>HTG</span>
      </div>
    )
  }

  // Default (Duplicate-mix or database)
  return (
    <div
      className={`flex size-[26px] items-center justify-center rounded-full bg-[#E8F0FE] text-[#1a73e8] shadow-sm shrink-0 ${className}`}
      title="Duplicate-mix"
    >
      <Database className="size-[13px]" />
    </div>
  )
}

export default function Page() {
  const [query, setQuery] = useState('')
  const [field, setField] = useState('auto')
  const [dataset, setDataset] = useState<string>('all')
  const [maxScan, setMaxScan] = useState(5000)
  const [results, setResults] = useState<Result[]>([])
  const [searched, setSearched] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [expandedIndex, setExpandedIndex] = useState<number | null>(null)
  const [copiedId, setCopiedId] = useState<string | null>(null)
  const [progress, setProgress] = useState<Progress | null>(null)
  const abortRef = useRef<AbortController | null>(null)

  const cancelSearch = useCallback(() => {
    if (abortRef.current) {
      abortRef.current.abort()
      abortRef.current = null
    }
    setLoading(false)
    setProgress(prev => (prev ? { ...prev, status: 'Cancelled' } : null))
  }, [])

  async function runSearch(overrideQuery?: string, overrideField?: string, overrideDataset?: string) {
    const value = (overrideQuery !== undefined ? overrideQuery : query).trim()
    if (!value) return

    // Immediately cancel any currently executing search
    if (abortRef.current) {
      abortRef.current.abort()
      abortRef.current = null
    }

    const controller = new AbortController()
    abortRef.current = controller

    if (overrideQuery !== undefined) setQuery(overrideQuery)
    const activeField = overrideField ?? field
    const activeDataset = overrideDataset ?? dataset

    setLoading(true)
    setSearched(true)
    setError('')
    setResults([])
    setExpandedIndex(null)
    setProgress({ scanned: 0, matches: 0, wave: 0, elapsed: 0, status: 'Starting search...' })

    try {
      const baseUrl = process.env.NEXT_PUBLIC_API_URL?.replace(/\/$/, '') || ''
      const endpoint = new URL(`${baseUrl}/api/search/stream`, typeof window !== 'undefined' ? window.location.origin : 'http://localhost:3000')
      endpoint.searchParams.set('q', value)
      endpoint.searchParams.set('limit', '10')
      endpoint.searchParams.set('field', activeField)
      endpoint.searchParams.set('dataset', activeDataset)
      endpoint.searchParams.set('max_scan', String(maxScan))

      const response = await fetch(endpoint.toString(), {
        signal: controller.signal,
        headers: { Accept: 'text/event-stream' },
      })

      if (!response.ok) {
        throw new Error(`Search request returned status ${response.status}`)
      }
      if (!response.body) {
        throw new Error('No streaming response body available')
      }

      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''

      while (true) {
        const { done, value: chunk } = await reader.read()
        if (done) break
        if (controller.signal.aborted) break

        buffer += decoder.decode(chunk, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() ?? ''

        let currentEvent = ''
        for (const line of lines) {
          if (line.startsWith('event: ')) {
            currentEvent = line.slice(7).trim()
          } else if (line.startsWith('data: ')) {
            const data = line.slice(6)
            try {
              const parsed = JSON.parse(data)
              if (currentEvent === 'match') {
                setResults(prev => [...prev, parsed])
              } else if (currentEvent === 'progress') {
                setProgress(parsed)
              } else if (currentEvent === 'done') {
                setProgress(prev => ({
                  scanned: parsed.scanned ?? prev?.scanned ?? 0,
                  matches: parsed.matches ?? prev?.matches ?? 0,
                  wave: prev?.wave ?? 0,
                  elapsed: parsed.elapsed ?? prev?.elapsed ?? 0,
                  status: 'Done',
                }))
              } else if (currentEvent === 'error') {
                setError(parsed.detail ?? 'Search encountered an issue')
              }
            } catch {
              // Ignore partial or non-json stream chunks
            }
          }
        }
      }
    } catch (err: unknown) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        // User intentionally cancelled or started a new search
      } else {
        const message = err instanceof Error ? err.message : 'Search request failed.'
        setError(`${message} Please verify your network connection and try again.`)
      }
    } finally {
      if (abortRef.current === controller) {
        setLoading(false)
        abortRef.current = null
      }
    }
  }

  function goHome() {
    if (abortRef.current) {
      abortRef.current.abort()
      abortRef.current = null
    }
    setLoading(false)
    setQuery('')
    setSearched(false)
    setResults([])
    setError('')
    setProgress(null)
    setExpandedIndex(null)
  }

  const copyRecord = (row: Result, idKey: string) => {
    navigator.clipboard.writeText(JSON.stringify(row, null, 2))
    setCopiedId(idKey)
    setTimeout(() => setCopiedId(null), 2000)
  }

  const pct = progress && maxScan > 0 ? Math.min(100, (progress.scanned / maxScan) * 100) : 0

  // ──────────────────────────────────────────────────
  //  RESULTS PAGE (Google SERP layout)
  // ──────────────────────────────────────────────────
  if (searched) {
    return (
      <main className="min-h-screen bg-white text-[#202124]">
        {/* ── Top bar with logo + search ── */}
        <header className="sticky top-0 z-10 border-b border-[#ebebeb] bg-white">
          <div className="flex items-center gap-5 px-6 py-3">
            {/* Compact logo */}
            <button
              onClick={goHome}
              className="shrink-0 cursor-pointer text-[26px] font-medium tracking-[-0.06em] leading-none transition-transform hover:scale-105"
              aria-label="Go home"
            >
              <span className="text-[#4285f4]">W</span>
              <span className="text-[#ea4335]">H</span>
              <span className="text-[#fbbc05]">O</span>
              <span className="text-[#4285f4]">?</span>
              <span className="text-[#34a853]">g</span>
              <span className="text-[#ea4335]">l</span>
              <span className="text-[#4285f4]">e</span>
            </button>

            {/* Search bar */}
            <div className="flex h-[44px] w-full max-w-[692px] items-center rounded-full border border-[#dfe1e5] px-4 shadow-sm transition hover:shadow-md focus-within:shadow-md">
              <Search className="mr-3 size-[18px] shrink-0 text-[#9aa0a6]" />
              <input
                value={query}
                onChange={e => setQuery(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter' && !e.nativeEvent.isComposing) runSearch()
                }}
                className="min-w-0 flex-1 bg-transparent text-[16px] outline-none placeholder:text-[#9aa0a6]"
                placeholder="Search phone, name, Aadhaar, address…"
                aria-label="Search dataset"
              />
              {query && (
                <button
                  onClick={() => setQuery('')}
                  className="mr-2 rounded-full p-1 text-[#70757a] hover:bg-[#f1f3f4]"
                  aria-label="Clear"
                >
                  <X className="size-4" />
                </button>
              )}
              <button
                onClick={() => runSearch()}
                className="rounded-full p-1.5 text-[#4285f4] hover:bg-[#f1f3f4]"
                aria-label="Search"
              >
                <Search className="size-[18px]" />
              </button>
            </div>

            <div className="ml-auto flex items-center gap-3">
              {/* Google-colored question icon */}
              <div className="flex size-9 items-center justify-center rounded-full border-2 border-transparent bg-white shadow-sm" style={{background: 'conic-gradient(#4285f4 0deg 90deg, #ea4335 90deg 180deg, #fbbc05 180deg 270deg, #34a853 270deg 360deg)'}}>
                <div className="flex size-7 items-center justify-center rounded-full bg-white">
                  <span className="text-[15px] font-bold" style={{background: 'linear-gradient(135deg, #4285f4 0%, #ea4335 33%, #fbbc05 66%, #34a853 100%)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text'}}>?</span>
                </div>
              </div>
            </div>
          </div>

          {/* Filter tabs row - left aligned with search input */}
          <div className="flex items-center gap-6 px-4 md:px-0 md:ml-[160px] pb-0 text-[13px] text-[#5f6368] overflow-x-auto">
            <button
              onClick={() => {
                setDataset('all')
                if (query.trim()) runSearch(query.trim(), field, 'all')
              }}
              className={`pb-3 font-medium flex items-center gap-1.5 shrink-0 transition-colors ${
                dataset === 'all'
                  ? 'border-b-[3px] border-[#1a73e8] text-[#1a73e8]'
                  : 'hover:text-[#202124] text-[#5f6368]'
              }`}
            >
              <Search className="size-3.5" /> All
            </button>
            <button
              onClick={() => {
                setDataset('duplicate')
                if (query.trim()) runSearch(query.trim(), field, 'duplicate')
              }}
              className={`pb-3 font-medium flex items-center gap-1.5 shrink-0 transition-colors ${
                dataset === 'duplicate'
                  ? 'border-b-[3px] border-[#1a73e8] text-[#1a73e8]'
                  : 'hover:text-[#202124] text-[#5f6368]'
              }`}
            >
              <Database className="size-3.5" /> 5.01B Records
            </button>
            <button
              onClick={() => {
                setDataset('shatterme')
                if (query.trim()) runSearch(query.trim(), field, 'shatterme')
              }}
              className={`pb-3 font-medium flex items-center gap-1.5 shrink-0 transition-colors ${
                dataset === 'shatterme'
                  ? 'border-b-[3px] border-[#1a73e8] text-[#1a73e8]'
                  : 'hover:text-[#202124] text-[#5f6368]'
              }`}
            >
              <Database className="size-3.5" /> 2.50B Truecaller
            </button>
            <button
              onClick={() => {
                setDataset('phonebook')
                if (query.trim()) runSearch(query.trim(), field, 'phonebook')
              }}
              className={`pb-3 font-medium flex items-center gap-1.5 shrink-0 transition-colors ${
                dataset === 'phonebook'
                  ? 'border-b-[3px] border-[#1a73e8] text-[#1a73e8]'
                  : 'hover:text-[#202124] text-[#5f6368]'
              }`}
            >
              <Database className="size-3.5" /> 1.73B Phonebook
            </button>
            <button
              onClick={() => {
                setDataset('telegram')
                if (query.trim()) runSearch(query.trim(), field, 'telegram')
              }}
              className={`pb-3 font-medium flex items-center gap-1.5 shrink-0 transition-colors ${
                dataset === 'telegram'
                  ? 'border-b-[3px] border-[#1a73e8] text-[#1a73e8]'
                  : 'hover:text-[#202124] text-[#5f6368]'
              }`}
            >
              <Database className="size-3.5" /> 105M Telegram
            </button>
            <span className="ml-auto pb-3 text-[12px] flex items-center gap-3 shrink-0">
              <span>Database:</span>
              <select
                value={dataset}
                onChange={e => {
                  const newDataset = e.target.value
                  setDataset(newDataset)
                  if (query.trim()) runSearch(query.trim(), field, newDataset)
                }}
                className="rounded border border-[#dadce0] bg-white px-2 py-0.5 outline-none text-[#202124] text-[12px] hover:border-[#b0b3b8]"
              >
                <option value="all">All (11.43B)</option>
                <option value="duplicate">Records Database (5.01B)</option>
                <option value="shatterme">Truecaller Global (2.50B)</option>
                <option value="phonebook">Phonebook (1.73B)</option>
                <option value="hitecknuminfo">NuMinfo (1.78B)</option>
                <option value="truecaller">Truecaller (285M)</option>
                <option value="telegram">Telegram (105M)</option>
                <option value="paytm">Paytm (7.3M)</option>
                <option value="flipkart">Flipkart (3.8M)</option>
                <option value="hiteckgroup">HiTeckGroup (107K)</option>
              </select>
              <span>Field:</span>
              <select
                value={field}
                onChange={e => {
                  const newField = e.target.value
                  setField(newField)
                  if (query.trim()) runSearch(query.trim(), newField, dataset)
                }}
                className="rounded border border-[#dadce0] bg-white px-2 py-0.5 outline-none text-[#202124] text-[12px] hover:border-[#b0b3b8]"
              >
                <option value="auto">Auto detect</option>
                <option value="phone">Phone</option>
                <option value="name">Name</option>
                <option value="aadhar">Aadhaar</option>
                <option value="district">District</option>
                <option value="email">Email</option>
              </select>
              <span>Depth:</span>
              <select
                value={maxScan}
                onChange={e => {
                  const newMax = Number(e.target.value)
                  setMaxScan(newMax)
                  if (query.trim()) runSearch(query.trim(), field, dataset)
                }}
                className="rounded border border-[#dadce0] bg-white px-2 py-0.5 outline-none text-[#202124] text-[12px] hover:border-[#b0b3b8]"
              >
                <option value="1000">1K rows</option>
                <option value="5000">5K rows</option>
                <option value="10000">10K rows</option>
                <option value="25000">25K rows</option>
                <option value="50000">50K rows</option>
                <option value="100000">100K rows</option>
              </select>
            </span>
          </div>
        </header>

        {/* ── Results body: left-aligned directly under search bar ── */}
        <div className="w-full max-w-[652px] px-4 md:px-0 md:ml-[160px] pt-4 pb-16">
          {/* Stats line */}
          <div className="mb-4 text-[13px] text-[#70757a] flex items-center gap-2">
            {progress && (
              <>
                {loading && <Loader2 className="inline size-3.5 animate-spin text-[#1a73e8]" />}
                <span>
                  {progress.status === 'Done'
                    ? `About ${results.length} result${results.length !== 1 ? 's' : ''} (${progress.elapsed}s) — ${progress.scanned.toLocaleString()} rows scanned`
                    : `${progress.status} · ${progress.scanned.toLocaleString()} rows scanned · ${results.length} match${results.length !== 1 ? 'es' : ''}`}
                </span>
                {loading && (
                  <button
                    onClick={cancelSearch}
                    className="ml-2 inline-flex items-center gap-1 rounded border border-[#ea4335]/20 bg-[#fef7f6] px-2.5 py-0.5 text-[12px] text-[#ea4335] hover:bg-[#ea4335]/10"
                  >
                    <X className="size-3" /> Stop
                  </button>
                )}
              </>
            )}
          </div>

          {/* Progress bar */}
          {loading && (
            <div className="mb-5 h-[3px] w-full rounded-full bg-[#e8eaed] overflow-hidden">
              <div
                className="h-full rounded-full transition-all duration-500 ease-out"
                style={{ width: `${Math.max(15, pct)}%`, backgroundColor: '#1a73e8' }}
              />
            </div>
          )}

          {/* Error */}
          {error && (
            <div className="mb-5 rounded-lg border border-[#f1c4c0] bg-[#fef7f6] p-4 text-sm text-[#b3261e]">
              {error}
            </div>
          )}

          {/* No results */}
          {results.length === 0 && !loading && !error && (
            <div className="py-8 text-sm text-[#5f6368]">
              <p className="mb-2 font-medium text-[#202124]">No results found for &quot;{query}&quot;</p>
              <p>Try searching for a 10-digit mobile number, full name, district, or 12-digit Aadhaar number.</p>
            </div>
          )}

          {/* Google-style result cards */}
          <div className="flex flex-col gap-7">
            {results.map((row, index) => {
              const isExpanded = expandedIndex === index
              const title = buildTitle(row)
              const breadcrumb = buildBreadcrumb(row)
              const snippet = buildSnippet(row)
              const rowKey = `${row.row_idx ?? index}-${index}`

              return (
                <article key={rowKey} className="group max-w-[620px]">
                  {/* URL breadcrumb line with App Logo */}
                  <div className="flex items-center gap-2 mb-[3px]">
                    <SourceAppLogo source={row.source} />
                    <div className="min-w-0">
                      <div className="text-[14px] text-[#202124] truncate leading-tight font-normal flex items-center gap-2">
                        <span className="font-medium">{String(row.source || 'Duplicate-mix')}</span>
                        {Boolean(row.username) && (
                          <span className="rounded bg-[#e1f5fe] px-1.5 py-0.5 text-[11px] font-medium text-[#0288d1]">
                            @{String(row.username)}
                          </span>
                        )}
                        {Boolean(row.carrier) && (
                          <span className="rounded bg-[#e8f0fe] px-1.5 py-0.5 text-[11px] font-medium text-[#1a73e8]">
                            {String(row.carrier)}
                          </span>
                        )}
                        {Boolean(row.gender && String(row.gender).toUpperCase() !== 'UNKNOWN') && (
                          <span className="rounded bg-[#f1f3f4] px-1.5 py-0.5 text-[11px] font-medium text-[#5f6368]">
                            {String(row.gender)}
                          </span>
                        )}
                      </div>
                      <div className="text-[12px] text-[#4d5156] truncate leading-tight">{breadcrumb}</div>
                    </div>
                    <button
                      onClick={() => setExpandedIndex(isExpanded ? null : index)}
                      className="ml-auto shrink-0 rounded p-1 text-[#70757a] hover:bg-[#f1f3f4] transition"
                      aria-label={isExpanded ? 'Collapse' : 'Expand'}
                    >
                      <ChevronDown className={`size-4 transition-transform duration-200 ${isExpanded ? 'rotate-180' : ''}`} />
                    </button>
                  </div>

                  {/* Title */}
                  <h3>
                    <button
                      onClick={() => setExpandedIndex(isExpanded ? null : index)}
                      className="text-left text-[20px] leading-[1.3] text-[#1a0dab] hover:underline cursor-pointer decoration-[2px] underline-offset-2 font-normal"
                    >
                      {title}
                    </button>
                  </h3>

                  {/* Snippet */}
                  <p className="mt-[3px] text-[14px] leading-[1.58] text-[#4d5156]">
                    <span className="text-[#70757a] mr-1">Row {String(row.row_idx ?? row.id ?? '—')}</span>
                    — {snippet}
                  </p>

                  {/* Expanded details panel */}
                  {isExpanded && (
                    <div className="mt-3 rounded-xl border border-[#dadce0] bg-[#f8f9fa] p-5 text-[13px] text-[#3c4043] shadow-sm animate-in fade-in slide-in-from-top-1 duration-200">
                      <div className="flex items-center justify-between pb-3 border-b border-[#dadce0]/70 mb-3">
                        <span className="font-semibold text-[14px] text-[#202124]">
                          Complete Record Details (Row {String(row.row_idx ?? index)})
                        </span>
                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => copyRecord(row, rowKey)}
                            className="inline-flex items-center gap-1 rounded border border-[#dadce0] bg-white px-2.5 py-1 text-[12px] text-[#3c4043] hover:bg-[#f1f3f4] transition"
                          >
                            {copiedId === rowKey ? (
                              <>
                                <Check className="size-3 text-emerald-600" /> Copied
                              </>
                            ) : (
                              <>
                                <Copy className="size-3 text-[#5f6368]" /> Copy JSON
                              </>
                            )}
                          </button>
                          <button
                            onClick={() => setExpandedIndex(null)}
                            className="text-[12px] text-[#1a73e8] hover:underline px-1"
                          >
                            Close
                          </button>
                        </div>
                      </div>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-3">
                        <DetailField label="Full Name" value={row.name} />
                        {Boolean(row.username) && <DetailField label="Telegram Username" value={`@${row.username}`} highlight />}
                        {Boolean(row.userId) && <DetailField label="Telegram User ID" value={row.userId} />}
                        <DetailField label="Father's Name" value={row.fathersName} />
                        <DetailField label="Primary Phone" value={row.phoneNumber ?? row.phone} highlight />
                        {Boolean(row.carrier) && <DetailField label="Carrier" value={row.carrier} highlight />}
                        {Boolean(row.gender) && <DetailField label="Gender" value={row.gender} />}
                        <DetailField label="Other Phone" value={row.otherNumber} />
                        <DetailField label="Aadhaar" value={row.aadhar ?? row.aadharNumber} highlight />
                        <DetailField label="Email" value={row.email} />
                        {Boolean(row.bank) && <DetailField label="Bank" value={row.bank} highlight />}
                        {Boolean(row.pan) && <DetailField label="PAN" value={row.pan} highlight />}
                        {Boolean(row.dob) && <DetailField label="Date of Birth" value={row.dob} />}
                        {Boolean(row.income) && <DetailField label="Income" value={row.income} />}
                        {Boolean(row.country) && <DetailField label="Country" value={row.country} />}
                        <DetailField label="District" value={row.district} />
                        <DetailField label="State" value={row.state} />
                        <DetailField label="Town" value={row.town} />
                        <DetailField label="Pincode" value={row.pincode} />
                        <DetailField label="Source" value={row.source} />
                        <div className="sm:col-span-2">
                          <DetailField label="Address" value={row.address} />
                        </div>
                      </div>
                    </div>
                  )}
                </article>
              )
            })}
          </div>

          {/* Quick search chips */}
          {!loading && (
            <div className="mt-12 border-t border-[#ebebeb] pt-6">
              <p className="text-[14px] font-medium text-[#202124] mb-3 flex items-center gap-1.5">
                <Sparkles className="size-4 text-[#1a73e8]" /> Related Filters
              </p>
              <div className="flex flex-wrap gap-2">
                {[
                  { label: 'Search by Phone', f: 'phone' },
                  { label: 'Search by Name', f: 'name' },
                  { label: 'Search by Aadhaar', f: 'aadhar' },
                  { label: 'Search by District', f: 'district' },
                ].map(({ label, f }) => (
                  <button
                    key={f}
                    onClick={() => {
                      setField(f)
                      runSearch(query, f)
                    }}
                    className="rounded-full border border-[#dadce0] bg-white px-3.5 py-1.5 text-[13px] text-[#1a0dab] hover:bg-[#f8f9fa] transition-colors"
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Pagination-style footer */}
          {!loading && results.length > 0 && (
            <div className="mt-12 flex flex-col items-center">
              <div className="flex items-baseline gap-0 text-[22px] font-medium tracking-[-0.06em] leading-none mb-3" aria-hidden>
                <span className="text-[#4285f4]">W</span>
                <span className="text-[#ea4335]">H</span>
                <span className="text-[#fbbc05]">O</span>
                <span className="text-[#4285f4]">?</span>
                <span className="text-[#34a853]">g</span>
                <span className="text-[#ea4335]">l</span>
                <span className="text-[#4285f4]">e</span>
              </div>
              <p className="text-[12px] text-[#70757a]">
                WHO?gle Global Multi-Index Search Engine · Live Cloud Query
              </p>
            </div>
          )}
        </div>
      </main>
    )
  }

  // ──────────────────────────────────────────────────
  //  HOME PAGE (Google homepage layout)
  // ──────────────────────────────────────────────────
  return (
    <main className="min-h-screen bg-white text-[#202124] flex flex-col justify-between">
      {/* Header */}
      <header className="flex items-center justify-between px-6 py-4 text-sm text-[#5f6368]">
        <div className="flex items-center gap-3 flex-wrap">
          <span className="text-[#202124] font-medium">9 Databases</span>
          <span className="text-[#dadce0]">·</span>
          <span className="text-[11px]">Records 5B · Truecaller 2.5B · Phonebook 1.7B · NuMinfo 1.8B · Truecaller 285M · Telegram · Paytm · Flipkart · HiTeckGroup</span>
        </div>
        <div className="flex items-center gap-4">
          <div className="flex size-9 items-center justify-center rounded-full border-2 border-transparent bg-white shadow-sm" style={{background: 'conic-gradient(#4285f4 0deg 90deg, #ea4335 90deg 180deg, #fbbc05 180deg 270deg, #34a853 270deg 360deg)'}}>
            <div className="flex size-7 items-center justify-center rounded-full bg-white">
              <span className="text-[15px] font-bold" style={{background: 'linear-gradient(135deg, #4285f4 0%, #ea4335 33%, #fbbc05 66%, #34a853 100%)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text' as any}}>?</span>
            </div>
          </div>
        </div>
      </header>

      {/* Main search area */}
      <section className="flex flex-1 flex-col items-center justify-center px-5 pb-24">
        {/* Brand logo */}
        <div
          className="mb-7 flex items-center gap-0 text-[72px] font-medium leading-none tracking-[-0.08em] sm:text-[90px] select-none"
          aria-label="WHO?gle"
        >
          <span className="text-[#4285f4]">W</span>
          <span className="text-[#ea4335]">H</span>
          <span className="text-[#fbbc05]">O</span>
          <span className="text-[#4285f4]">?</span>
          <span className="text-[#34a853]">g</span>
          <span className="text-[#ea4335]">l</span>
          <span className="text-[#4285f4]">e</span>
        </div>
        <p className="mb-7 text-sm text-[#5f6368] text-center max-w-lg">
          Search <strong className="text-[#202124]">11,425,251,151</strong> records across 9 Global Indexed Databases
        </p>

        {/* Search input box */}
        <div className="w-full max-w-[584px]">
          <div className="flex h-12 items-center rounded-full border border-[#dfe1e5] px-4 shadow-sm transition hover:shadow-md focus-within:shadow-md focus-within:border-[#dfe1e5]">
            <Search className="mr-3 size-5 shrink-0 text-[#9aa0a6]" />
            <input
              value={query}
              onChange={e => setQuery(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter' && !e.nativeEvent.isComposing) runSearch()
              }}
              className="min-w-0 flex-1 bg-transparent text-[16px] outline-none placeholder:text-[#9aa0a6]"
              placeholder="Search phone number, name, Aadhaar, address…"
              aria-label="Search dataset"
              autoFocus
            />
            {query && (
              <button
                onClick={() => setQuery('')}
                className="mr-1 rounded-full p-1 text-[#70757a] hover:bg-[#f1f3f4]"
                aria-label="Clear input"
              >
                <X className="size-4" />
              </button>
            )}
          </div>

          {/* Action buttons */}
          <div className="mt-6 flex justify-center gap-3">
            <button
              onClick={() => runSearch()}
              className="rounded-md border border-[#f8f9fa] bg-[#f8f9fa] px-5 py-2.5 text-sm text-[#3c4043] shadow-sm hover:border-[#dadce0] hover:shadow transition"
            >
              WHO?gle Search
            </button>
            <button
              onClick={goHome}
              className="rounded-md border border-[#f8f9fa] bg-[#f8f9fa] px-5 py-2.5 text-sm text-[#3c4043] shadow-sm hover:border-[#dadce0] hover:shadow transition"
            >
              Clear
            </button>
          </div>

          {/* Filters */}
          <div className="mt-5 flex flex-wrap justify-center items-center gap-4 text-xs text-[#5f6368]">
            <label className="flex items-center gap-2">
              Database:
              <select
                value={dataset}
                onChange={e => setDataset(e.target.value)}
                className="rounded border border-[#dadce0] bg-white px-2 py-1 outline-none text-[#202124] hover:border-[#b0b3b8]"
              >
                <option value="all">All (11.43B)</option>
                <option value="duplicate">Records Database (5.01B)</option>
                <option value="shatterme">Truecaller Global (2.50B)</option>
                <option value="phonebook">Phonebook (1.73B)</option>
                <option value="hitecknuminfo">NuMinfo (1.78B)</option>
                <option value="truecaller">Truecaller (285M)</option>
                <option value="telegram">Telegram (105M)</option>
                <option value="paytm">Paytm (7.3M)</option>
                <option value="flipkart">Flipkart (3.8M)</option>
                <option value="hiteckgroup">HiTeckGroup (107K)</option>
              </select>
            </label>
            <label className="flex items-center gap-2">
              Field:
              <select
                value={field}
                onChange={e => setField(e.target.value)}
                className="rounded border border-[#dadce0] bg-white px-2 py-1 outline-none text-[#202124] hover:border-[#b0b3b8]"
              >
                <option value="auto">Auto detect</option>
                <option value="phone">Phone</option>
                <option value="name">Name</option>
                <option value="aadhar">Aadhaar</option>
                <option value="district">District</option>
                <option value="email">Email</option>
              </select>
            </label>
            <label className="flex items-center gap-2">
              Scan depth:
              <select
                value={maxScan}
                onChange={e => setMaxScan(Number(e.target.value))}
                className="rounded border border-[#dadce0] bg-white px-2 py-1 outline-none text-[#202124] hover:border-[#b0b3b8]"
              >
                <option value="1000">1,000 rows</option>
                <option value="5000">5,000 rows</option>
                <option value="10000">10,000 rows</option>
                <option value="25000">25,000 rows</option>
                <option value="50000">50,000 rows</option>
                <option value="100000">100,000 rows</option>
              </select>
            </label>
          </div>
        </div>


      </section>

      {/* Footer */}
      <footer className="border-t border-[#ebebeb] bg-[#f2f2f2] text-xs text-[#70757a]">
        <div className="flex flex-wrap items-center justify-between px-6 py-3">
          <div className="flex items-center gap-2">
            <span>WHO?gle Ultra-Fast Distributed Index</span>
          </div>
          <div className="flex items-center gap-5">
            <span>Zero configuration required</span>
            <span>Vercel & Netlify Ready</span>
          </div>
        </div>
      </footer>
    </main>
  )
}

/* ─── Detail field helper ─── */
function DetailField({
  label,
  value,
  highlight,
}: {
  label: string
  value: unknown
  highlight?: boolean
}) {
  return (
    <div className="flex flex-col">
      <span className="text-[11px] font-medium uppercase tracking-wider text-[#70757a] mb-0.5">
        {label}
      </span>
      <span className={`text-[13px] ${highlight && value ? 'font-semibold text-[#1a73e8]' : 'text-[#202124]'}`}>
        {value ? String(value) : '—'}
      </span>
    </div>
  )
}
