export type SearchRecord = {
  id: number | string
  dataset_id: number | string
  row_idx: number
  name: string | null
  phone: string | null
  email: string | null
  district: string | null
  aadhar: string | null
  address: string | null
  fathersName: string | null
  phoneNumber: string | null
  otherNumber: string | null
  aadharNumber: string | null
  source: string | null
  state: string | null
  town: string | null
  pincode: string | null
  carrier?: string | null
  gender?: string | null
  bank?: string | null
  pan?: string | null
  dob?: string | null
  income?: string | null
  country?: string | null
  username?: string | null
  userId?: string | null
}

export function cleanVal(v: unknown): string | null {
  if (v === null || v === undefined) return null
  const s = String(v).replace(/\x00/g, '').trim()
  if (!s || /^[.\s\-!]+$/.test(s)) return null
  return s
}

export function cleanPhone(v: unknown): string | null {
  if (!v) return null
  const s = String(v).replace(/\x00/g, '').trim()
  const nums = s.match(/[6-9]\d{9}/g)
  if (nums && nums.length > 0) return nums[nums.length - 1]
  const c = s.replace(/[\t\n\r"'\\]+/g, ' ').trim()
  return c || null
}

export function cleanAadhar(v: unknown): string | null {
  if (!v) return null
  const s = String(v).replace(/\x00/g, '').trim()
  if (!s || s.length < 12) return null
  const nums = s.match(/\d{12}/g)
  if (nums && nums.length > 0) return nums[0]
  return /\d/.test(s) ? s : null
}

export function extractDistrict(row: Record<string, unknown>): string | null {
  const d = cleanVal(row.district) || cleanVal(row.CustomerCity) || cleanVal(row.city)
  if (d) return d
  const addr = cleanVal(row.address) || cleanVal(row.CustomerAddress)
  if (addr && addr.includes('!')) {
    const parts = addr.split('!').map(p => p.trim()).filter(Boolean)
    if (parts.length >= 3) {
      return parts[parts.length - 3]
    }
  }
  return null
}

export function normalizeRecord(raw: Record<string, unknown>, rowIdx = 0, defaultSource?: string): SearchRecord {
  // Phone: handle all schemas
  const rawPhone = raw.phoneNumber ?? raw.phone ?? raw.Number ?? raw.number ?? raw.mobile ?? raw.CustomerPhone ?? raw.phone_number
  const rawAadhar = raw.aadharNumber ?? raw.aadhar ?? raw.AadharNumber
  // Name: handle all schemas
  const rawName = raw.name ?? raw.Name ?? raw.CustomerName ?? raw.username
  const rawEmail = raw.email ?? raw.Email ?? raw.CustomerEmail
  const rawAddress = raw.address ?? raw.Address ?? raw.CustomerAddress
  const rawFather = raw.fathersName ?? raw.father_name ?? raw.fname
  const rawCarrier = raw.carrier ?? raw.Carrier
  const rawGender = raw.gender ?? raw.Gender ?? raw.product_gender
  const rawState = raw.state ?? raw.CustomerState ?? raw.country
  const rawPincode = raw.pincode ?? raw.CustomerPincode
  const rawCircle = raw.circle

  const pp = cleanPhone(rawPhone)
  const ap = cleanPhone(raw.otherNumber ?? raw.other_number ?? raw.alt)
  const aadhar = cleanAadhar(rawAadhar)
  const district = extractDistrict(raw)

  return {
    id: rowIdx,
    dataset_id: rowIdx,
    row_idx: rowIdx,
    name: cleanVal(rawName),
    phone: pp || ap,
    email: cleanVal(rawEmail),
    district,
    aadhar,
    address: cleanVal(rawAddress),
    fathersName: cleanVal(rawFather),
    phoneNumber: pp,
    otherNumber: ap,
    aadharNumber: aadhar,
    source: cleanVal(raw.source) || defaultSource || 'Duplicate-mix',
    state: cleanVal(rawState),
    town: cleanVal(raw.town) || cleanVal(rawCircle),
    pincode: cleanVal(rawPincode),
    carrier: cleanVal(rawCarrier),
    gender: cleanVal(rawGender),
    bank: cleanVal(raw.bank),
    pan: cleanVal(raw.pan),
    dob: cleanVal(raw.dob),
    income: cleanVal(raw.income),
    country: cleanVal(raw.country) || cleanVal(raw.country_code),
    username: cleanVal(raw.username),
    userId: cleanVal(raw.user_id),
  }
}

export function getIdentityKey(row: SearchRecord): string {
  const p = row.phone || ''
  const a = row.aadhar || ''
  const n = (row.name || row.username || '').toLowerCase()
  return `${p}|${a}|${n}`
}

export function matchesQuery(row: SearchRecord, q: string, field = 'auto'): boolean {
  const term = q.trim().toLowerCase()
  if (!term) return true

  const digits = term.replace(/\D/g, '')

  if (field === 'phone') {
    return !!(digits && (row.phone?.includes(digits) || row.phoneNumber?.includes(digits) || row.otherNumber?.includes(digits)))
  }

  if (field === 'aadhar' || field === 'aadhaar') {
    return !!(digits && (row.aadhar?.includes(digits) || row.aadharNumber?.includes(digits)))
  }

  if (field === 'district') {
    return !!(row.district?.toLowerCase().includes(term) || row.state?.toLowerCase().includes(term))
  }

  if (field === 'name') {
    return !!(row.name?.toLowerCase().includes(term) || row.fathersName?.toLowerCase().includes(term) || row.username?.toLowerCase().includes(term))
  }

  if (field === 'email') {
    return !!(row.email?.toLowerCase().includes(term))
  }

  // Auto mode
  if (digits.length === 10 && /^[6-9]/.test(digits)) {
    return !!(row.phone?.includes(digits) || row.phoneNumber?.includes(digits) || row.otherNumber?.includes(digits))
  }

  if (digits.length === 12) {
    return !!(row.aadhar?.includes(digits) || row.aadharNumber?.includes(digits))
  }

  // Full-text across searchable fields
  const haystack = [
    row.name,
    row.username,
    row.userId,
    row.fathersName,
    row.phone,
    row.phoneNumber,
    row.otherNumber,
    row.aadhar,
    row.aadharNumber,
    row.address,
    row.district,
    row.state,
    row.town,
    row.pincode,
    row.email,
    row.carrier,
    row.gender,
    row.bank,
    row.pan,
    row.dob,
    row.income,
    row.country,
  ].filter(Boolean).join(' ').toLowerCase()

  return haystack.includes(term)
}
