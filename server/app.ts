import { Hono } from 'hono'
import { filterJobs, type Job, type JobFilters } from '../src/shared/jobs.js'
import { createD1AiQuotaStore, createAiChatHandlers, type AiJobContext, type AiJobSearch, type AiJobSearchResult, type AiQuotaDatabase } from './ai-chat.js'
import { getAuthSession, handleAuthRequest, type AuthBindings } from './auth.js'

/**
 * Bindings are optional so the same Hono app can boot in local Node development
 * while every job response still comes from the configured D1 jobstore.
 * Bind the job catalog as JOBSTORE (or DB), Findmeajob user data as AUTH_DB,
 * and a Vectorize index as VECTORIZE (or JOB_INDEX). No credentials are ever
 * returned by these routes.
 */
type D1Result = { results?: Record<string, unknown>[]; meta?: Record<string, unknown> }
type D1Statement = { bind: (...values: unknown[]) => D1Statement; all: <T = Record<string, unknown>>() => Promise<D1Result & { results?: T[] }> }
type D1DatabaseLike = { prepare: (query: string) => D1Statement }
type VectorizeLike = { query: (vector: number[], options?: Record<string, unknown>) => Promise<{ matches?: VectorMatch[] }> }
type VectorMatch = { id?: string; score?: number; metadata?: Record<string, unknown> }
type R2ObjectLike = { body: any; httpMetadata?: { contentType?: string }; httpEtag?: string }
type R2ListResult = { objects?: Array<{ key: string }>; truncated?: boolean; cursor?: string }
type R2BucketLike = { get: (key: string) => Promise<R2ObjectLike | null>; list: (options?: { limit?: number; cursor?: string }) => Promise<R2ListResult> }
type RateLimitLike = { limit: (options: { key: string }) => Promise<{ success: boolean }> }
type CloudflareRequest = Request & { cf?: { country?: string | null } }

export interface Bindings {
  DB?: D1DatabaseLike
  JOBSTORE?: D1DatabaseLike
  AUTH_DB?: D1DatabaseLike
  JOB_TABLE?: string
  JOBSTORE_TABLE?: string
  VECTORIZE?: VectorizeLike
  JOB_INDEX?: VectorizeLike
  COMPANY_LOGOS?: R2BucketLike
  READ_RATE_LIMITER?: RateLimitLike
  PUBLIC_JOB_RATE_LIMITER?: RateLimitLike
  JOB_LIST_RATE_LIMITER?: RateLimitLike
  JOB_DETAIL_RATE_LIMITER?: RateLimitLike
  SEARCH_RATE_LIMITER?: RateLimitLike
  VOYAGE_API_KEY?: string
  VOYAGE_EMBED_MODEL?: string
  TURNSTILE_SECRET_KEY?: string
  TURNSTILE_REQUIRED?: string
  SEARCH_ENABLED?: string
  ALLOWED_ORIGINS?: string
  APPLY_URL_HOSTS?: string
  BETTER_AUTH_SECRET?: string
  BETTER_AUTH_URL?: string
  BETTER_AUTH_TRUSTED_ORIGINS?: string
  GOOGLE_CLIENT_ID?: string
  GOOGLE_CLIENT_SECRET?: string
  OPENAI_API_KEY?: string
  OPENAI_AI_MODEL?: string
  AI_RATE_LIMITER?: RateLimitLike
}

type Env = { Bindings: Bindings }
const app = new Hono<Env>()

/** ISO country code supplied by Cloudflare for the current visitor. */
export const visitorCountryCode = (request: Request) => {
  const cloudflareCountry = (request as CloudflareRequest).cf?.country
  const candidate = cloudflareCountry
    || request.headers.get('CF-IPCountry')
    || request.headers.get('X-Findmeajob-Visitor-Country')
    || ''
  const normalized = candidate.trim().toUpperCase()
  return /^[A-Z]{2}$/.test(normalized) ? normalized : ''
}

const countryDisplayNames = new Intl.DisplayNames(['en'], { type: 'region' })
const visitorCountryName = (request: Request) => {
  const code = visitorCountryCode(request)
  if (!code) return ''
  try { return countryDisplayNames.of(code)?.trim() || '' } catch { return '' }
}

const requestId = () => typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : Math.random().toString(36).slice(2)
const allowedMethods = (pathname: string) => {
  if (pathname.startsWith('/api/auth/')) return ['GET', 'POST']
  if (pathname === '/api/jobs/search' || pathname === '/api/ai/chat') return ['POST']
  if (pathname === '/api/ai/usage') return ['GET']
  if (pathname === '/api/health' || pathname === '/api/jobs' || pathname.startsWith('/api/jobs/') || pathname.startsWith('/api/logos/')) return ['GET']
  return null
}
const configuredOrigins = (env: Bindings | undefined) => (env?.ALLOWED_ORIGINS || '').split(',').map((value) => value.trim()).filter(Boolean)

app.use('/api/*', async (c, next) => {
  const pathname = new URL(c.req.url).pathname
  const methods = allowedMethods(pathname)
  const origin = c.req.header('Origin')
  const ownOrigin = new URL(c.req.url).origin
  const crossOriginAllowed = origin && (origin === ownOrigin || configuredOrigins(c.env).includes(origin))

  c.header('X-Request-ID', c.req.header('X-Request-ID')?.slice(0, 128) || requestId())
  c.header('X-Content-Type-Options', 'nosniff')
  c.header('X-Frame-Options', 'DENY')
  c.header('X-Robots-Tag', 'noindex, nofollow, noarchive')
  c.header('Cross-Origin-Resource-Policy', 'same-origin')
  c.header('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'; base-uri 'none'")
  c.header('Cache-Control', 'no-store')

  if (origin && origin !== ownOrigin && !crossOriginAllowed) return c.json({ error: 'Origin is not allowed' }, 403)
  if (c.req.method === 'OPTIONS') {
    if (!crossOriginAllowed || !methods) return c.json({ error: 'Not found' }, 404)
    c.header('Access-Control-Allow-Origin', origin)
    c.header('Access-Control-Allow-Methods', methods.join(', '))
    c.header('Access-Control-Allow-Headers', 'Content-Type, CF-Turnstile-Response')
    c.header('Access-Control-Max-Age', '600')
    c.header('Vary', 'Origin')
    return c.body(null, 204)
  }
  if (methods && !methods.includes(c.req.method)) {
    c.header('Allow', methods.join(', '))
    return c.json({ error: 'Method not allowed' }, 405)
  }

  if (crossOriginAllowed && origin) {
    c.header('Access-Control-Allow-Origin', origin)
    c.header('Vary', 'Origin')
  }
  await next()
})

const asText = (value: unknown): string => {
  if (value == null) return ''
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return String(value)
  if (Array.isArray(value)) return value.map(asText).filter(Boolean).join(', ')
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>
    for (const key of ['name', 'label', 'value', 'text', 'title', 'display', 'country', 'city']) {
      const text = asText(record[key])
      if (text) return text
    }
  }
  return ''
}
const first = (row: Record<string, unknown>, names: string[]) => {
  for (const name of names) {
    const value = row[name] ?? row[name.toLowerCase()] ?? row[name.toUpperCase()]
    if (value != null && value !== '') return value
  }
  return undefined
}
const mergeListFragments = (values: readonly string[]): string[] => {
  const merged: string[] = []
  for (const value of values) {
    const item = value.trim()
    if (!item) continue
    const previous = merged[merged.length - 1]
    if (previous) {
      const openParens = (previous.match(/\(/g) || []).length
      const closeParens = (previous.match(/\)/g) || []).length
      // A few rows were ingested as one array item per comma inside a
      // parenthetical list. Join only genuinely unfinished fragments.
      if (openParens > closeParens) {
        merged[merged.length - 1] = `${previous} ${item}`
        continue
      }
    }
    merged.push(item)
  }
  return merged
}

// Keep comma-rich prose together. Only split at a new labelled section (for
// example “Nice to have:”), otherwise commas inside a sentence or parenthetical
// technology list are part of the same detail.
const splitProseSections = (value: string) => value
  .replace(/,\s+(?=(?:nice[- ]to[- ]have|bonus points?|strong bonus|preferred|must have|additional context|interview process)\s*:)/gi, '\n')
  .replace(/(?<=[.!?])\s+(?=(?:nice[- ]to[- ]have|bonus points?|strong bonus|preferred|must have|additional context|interview process)\s*:)/gi, '\n')
  .split(/\r?\n/)

const asArray = (value: unknown): string[] => {
  if (Array.isArray(value)) return mergeListFragments(value.map(asText).filter(Boolean))
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value)
      if (Array.isArray(parsed)) return mergeListFragments(parsed.map(asText).filter(Boolean))
    } catch { /* plain delimited text */ }
    const normalized = value
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/?li[^>]*>/gi, '\n')
    return mergeListFragments(splitProseSections(normalized).flatMap((section) => section.split(/\r?\n|\s*\|\s*/))
      .map((part) => part.replace(/^\s*[-*•]\s*/, '').trim())
      .filter(Boolean))
  }
  return []
}
const formatPosted = (value: unknown) => {
  const text = asText(value)
  const numeric = Number(text)
  if (!Number.isFinite(numeric) || numeric <= 0) return text || 'Recently'
  const timestamp = new Date(numeric < 10_000_000_000 ? numeric * 1000 : numeric).getTime()
  if (!Number.isFinite(timestamp)) return text || 'Recently'
  const days = Math.max(0, Math.floor((Date.now() - timestamp) / 86_400_000))
  if (days < 1) return 'Today'
  if (days < 7) return `${days} day${days === 1 ? '' : 's'} ago`
  if (days < 30) return `${Math.floor(days / 7)} week${Math.floor(days / 7) === 1 ? '' : 's'} ago`
  if (days < 365) return `${Math.floor(days / 30)} month${Math.floor(days / 30) === 1 ? '' : 's'} ago`
  return `${Math.floor(days / 365)} year${Math.floor(days / 365) === 1 ? '' : 's'} ago`
}

const isoDate = (value: unknown) => {
  const text = asText(value).trim()
  if (!text || /^(today|recently|\d+\s+(?:day|days|week|weeks|month|months|year|years)\s+ago)$/i.test(text)) return undefined
  const timestamp = Date.parse(text)
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : undefined
}

const uniqueText = (values: readonly string[]) => Array.from(new Set(values.map((value) => value.trim()).filter((value) => value && !/^\[object object\]$/i.test(value))))

// Jobstore rows contain both a normalized country column and free-form location
// text. Prefer the country column and only use the text as a fallback so city,
// state, and remote qualifiers do not become duplicate filter values.
const countryAliases: Array<[string, string]> = [
  ['united states of america', 'United States'], ['united states', 'United States'], ['usa', 'United States'], ['u.s.a.', 'United States'], ['u.s.', 'United States'],
  ['united kingdom', 'United Kingdom'], ['great britain', 'United Kingdom'], ['uk', 'United Kingdom'],
  ['czech republic', 'Czech Republic'], ['czechia', 'Czech Republic'], ['south korea', 'South Korea'], ['republic of korea', 'South Korea'],
  ['uae', 'United Arab Emirates'], ['united arab emirates', 'United Arab Emirates'],
  ['canada', 'Canada'], ['india', 'India'], ['france', 'France'], ['belgium', 'Belgium'], ['poland', 'Poland'], ['brazil', 'Brazil'],
  ['germany', 'Germany'], ['netherlands', 'Netherlands'], ['australia', 'Australia'], ['singapore', 'Singapore'], ['ireland', 'Ireland'],
  ['spain', 'Spain'], ['portugal', 'Portugal'], ['italy', 'Italy'], ['israel', 'Israel'], ['japan', 'Japan'], ['sweden', 'Sweden'],
  ['denmark', 'Denmark'], ['norway', 'Norway'], ['finland', 'Finland'], ['switzerland', 'Switzerland'], ['austria', 'Austria'],
  ['new zealand', 'New Zealand'], ['south africa', 'South Africa'], ['mexico', 'Mexico'], ['turkey', 'Türkiye'],
]

const cityCountries: Array<[string, string]> = [
  ['bengaluru', 'India'], ['bangalore', 'India'], ['mumbai', 'India'], ['chennai', 'India'], ['hyderabad', 'India'], ['delhi', 'India'], ['bhubaneswar', 'India'],
  ['austin', 'United States'], ['new york', 'United States'], ['nyc', 'United States'], ['san francisco', 'United States'], ['seattle', 'United States'],
]
const countryCodes: Record<string, string> = { US: 'United States', CA: 'Canada', IN: 'India', GB: 'United Kingdom', FR: 'France', DE: 'Germany', AU: 'Australia', SG: 'Singapore', IE: 'Ireland', ES: 'Spain', IT: 'Italy', BR: 'Brazil', NL: 'Netherlands', PL: 'Poland' }

const countryFromText = (value: unknown) => {
  const text = asText(value).trim().toLowerCase()
  if (!text) return ''
  const alias = [...countryAliases, ...cityCountries].sort((a, b) => b[0].length - a[0].length).find(([needle]) => text === needle || text.includes(needle))
  if (alias) return alias[1]
  if (/\bremote\b/i.test(text)) return 'Remote'
  return ''
}

const normalizeCountries = (source: Record<string, unknown>, rawLocations: string[]) => {
  const explicit = asText(first(source, ['country', 'country_name', 'nation']))
  const fromExplicit = countryCodes[explicit.trim().toUpperCase()] || countryFromText(explicit)
  if (fromExplicit) return [fromExplicit]
  const inferred = uniqueText(rawLocations.map(countryFromText).filter(Boolean))
  return inferred.length ? inferred.slice(0, 1) : (rawLocations.length ? [rawLocations[0]] : ['Remote'])
}

const currencySymbol = (value: unknown) => ({ USD: '$', CAD: 'C$', EUR: '€', GBP: '£', INR: '₹', AUD: 'A$', SGD: 'S$' } as Record<string, string>)[asText(value).trim().toUpperCase()] || asText(value).trim().toUpperCase()
const numericAmount = (value: unknown) => {
  const text = asText(value).replace(/,/g, '').trim()
  const number = Number.parseFloat(text.replace(/[^\d.]/g, ''))
  if (!Number.isFinite(number)) return null
  if (/m$/i.test(text)) return number * 1_000_000
  if (/k$/i.test(text)) return number * 1_000
  return number
}
const displayAmount = (value: number, symbol: string) => {
  if (value >= 1_000_000) return `${symbol}${Math.round(value / 100_000) / 10}M`
  if (value >= 10_000) return `${symbol}${Math.round(value / 1_000)}K`
  return `${symbol}${Math.round(value)}`
}
const normalizeCompensation = (source: Record<string, unknown>) => {
  const raw = first(source, ['compensation', 'salary', 'salary_raw', 'salary_range', 'pay'])
  const rawRecord = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw as Record<string, unknown> : undefined
  const min = numericAmount(first(source, ['salary_min']) ?? first(rawRecord || {}, ['salary_min', 'min', 'minimum', 'from']))
  const max = numericAmount(first(source, ['salary_max']) ?? first(rawRecord || {}, ['salary_max', 'max', 'maximum', 'to']))
  const symbol = currencySymbol(first(source, ['salary_currency']) ?? first(rawRecord || {}, ['salary_currency', 'currency', 'currency_code'])) || '$'
  if (min != null || max != null) {
    if (min != null && max != null) return [`${displayAmount(min, symbol)} - ${displayAmount(max, symbol)}`]
    return [displayAmount(min ?? max ?? 0, symbol)]
  }
  if (raw == null) return []
  if (Array.isArray(raw)) return uniqueText(raw.map(asText).filter((value) => value && !/^0+(?:usd)?$/i.test(value.trim())))
  if (rawRecord) {
    const rawLabel = first(rawRecord, ['range', 'label', 'text', 'value', 'display', 'salary'])
    if (rawLabel == null) return []
    return normalizeCompensation({ ...source, compensation: asText(rawLabel) })
  }
  const text = asText(raw).replace(/(\d),(?=\d{3}\b)/g, '$1').replace(/\s+/g, ' ').trim()
  if (!text) return []
  const range = text.match(/([$€£₹]?\s*[\d.]+\s*[kKmM]?)\s*(?:-|–|to)\s*([$€£₹]?\s*[\d.]+\s*[kKmM]?)/i)
  if (range) {
    const left = numericAmount(range[1]); const right = numericAmount(range[2])
    const rangeSymbol = range[1].match(/[$€£₹]/)?.[0] || symbol
    if (left != null && right != null) return [`${displayAmount(left, rangeSymbol)} - ${displayAmount(right, rangeSymbol)}`]
  }
  return [text]
}

const safeHttpsUrl = (value: unknown, allowedHosts: readonly string[] = []) => {
  const candidate = asText(value).trim()
  if (!candidate) return ''
  try {
    const url = new URL(candidate)
    const hostAllowed = allowedHosts.length === 0 || allowedHosts.some((host) => url.hostname === host || url.hostname.endsWith(`.${host}`))
    return url.protocol === 'https:' && !url.username && !url.password && hostAllowed ? url.toString() : ''
  } catch { return '' }
}

/** Map common jobstore schemas into the canonical client Job shape. */
const normalizeJob = (row: Record<string, unknown>, index = 0): Job | null => {
  let structured: Record<string, unknown> = {}
  const structuredRaw = row.structured_json
  if (typeof structuredRaw === 'string') { try { structured = JSON.parse(structuredRaw) as Record<string, unknown> } catch { /* malformed structured data */ } }
  const source = { ...structured, ...row }
  if (row.location_raw) source.location = row.location_raw
  if (row.salary_raw) source.salary = row.salary_raw
  const company = asText(first(source, ['company', 'company_name', 'employer', 'organization']))
  const role = asText(first(source, ['role', 'title', 'job_title', 'position', 'name']))
  if (!company && !role) return null
  const id = asText(first(source, ['id', 'slug', 'job_id', 'external_id'])) || `${company}-${role}-${index}`.toLowerCase().replace(/[^a-z0-9]+/g, '-')
  const rawLocations = asArray(first(source, ['locations', 'location', 'location_raw', 'countries', 'country', 'city']))
  const locations = normalizeCountries(source, rawLocations)
  const compensation = normalizeCompensation(source)
  const responsibilities = asArray(first(source, ['responsibilities', 'what_youll_do', 'duties']))
  const requirements = asArray(first(source, ['requirements', 'qualifications']))
  const benefits = asArray(first(source, ['benefits', 'perks']))
  const extras = asArray(first(source, ['jd_extras', 'extras', 'additional_details']))
  const slugify = (value: string) => value.trim().toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
  const companySlug = asText(first(source, ['company_slug', 'companySlug'])) || slugify(company)
  const suppliedLogo = asText(first(source, ['logoUrl', 'logo_url', 'company_logo', 'logo']))
  const datePosted = isoDate(first(source, ['datePosted', 'posted_at', 'created_at', 'date']))
  const dateModified = isoDate(first(source, ['dateModified', 'updated_at', 'modified_at']))
  return {
    id,
    company: company || 'Unknown company',
    role: role || 'Findmeajob',
    posted: formatPosted(first(source, ['posted', 'posted_at', 'created_at', 'date'])),
    locations: locations.length ? locations : ['Remote'],
    compensation,
    applyUrl: safeHttpsUrl(first(source, ['applyUrl', 'apply_url', 'apply_url_final_url', 'url', 'application_url', 'link'])),
    logoUrl: companySlug ? `/api/logos/${encodeURIComponent(companySlug.toLowerCase())}` : (suppliedLogo || ''),
    description: asText(first(source, ['description', 'summary', 'role_overview', 'about'])) || asText(first(source, ['company_about'])),
    companyAbout: asText(first(source, ['company_about', 'companyAbout'])),
    responsibilities,
    requirements,
    benefits,
    extras,
    ...(datePosted ? { datePosted } : {}),
    ...(dateModified ? { dateModified } : {}),
    ...(asText(first(source, ['employmentType', 'employment_type'])) ? { employmentType: asText(first(source, ['employmentType', 'employment_type'])) } : {}),
    ...(asText(first(source, ['workMode', 'work_mode'])) ? { workMode: asText(first(source, ['workMode', 'work_mode'])) } : {}),
  }
}

const getDb = (env?: Bindings) => env?.JOBSTORE ?? env?.DB
const getVectorIndex = (env?: Bindings) => env?.VECTORIZE ?? env?.JOB_INDEX
const safeTable = (table: string | undefined) => {
  const candidate = table || 'jobs'
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(candidate) ? candidate : 'jobs'
}
const JOB_COLUMNS = 'job_id, company, company_slug, title, salary_raw, salary_min, salary_max, salary_currency, location_raw, country, city, company_logo, apply_url_final_url, role_overview, company_about, jd_extras, structured_json, seniority, employment_type, work_mode, posted_at, updated_at'
let logoIndex: Map<string, string> | null = null
let logoIndexPromise: Promise<Map<string, string>> | null = null

const buildLogoIndex = async (bucket: R2BucketLike): Promise<Map<string, string>> => {
  const index = new Map<string, string>()
  let cursor: string | undefined
  for (let page = 0; page < 100; page += 1) {
    const result = await bucket.list({ limit: 1000, ...(cursor ? { cursor } : {}) })
    for (const object of result.objects ?? []) {
      const filename = object.key.split('/').pop() ?? ''
      const match = filename.match(/^\d+-([a-z0-9][a-z0-9-]*)\.(?:png|jpe?g|webp|svg)$/i)
      if (match && !index.has(match[1].toLowerCase())) index.set(match[1].toLowerCase(), object.key)
    }
    if (!result.truncated || !result.cursor) break
    cursor = result.cursor
  }
  return index
}

const resolveLogoKey = async (env: Bindings | undefined, slug: string) => {
  const bucket = env?.COMPANY_LOGOS
  if (!bucket) return null
  if (!logoIndex) {
    logoIndexPromise ||= buildLogoIndex(bucket).then((index) => { logoIndex = index; return index }).finally(() => { logoIndexPromise = null })
    logoIndex = await logoIndexPromise
  }
  return logoIndex.get(slug.toLowerCase()) ?? null
}

export async function readD1Jobs(env: Bindings | undefined, limit = 500): Promise<Job[] | null> {
  const db = getDb(env)
  if (!db) return null
  try {
    // Keep Worker responses bounded; the jobstore contains tens of thousands
    // of historical rows and only active records should reach the UI.
    const safeLimit = Math.max(1, Math.min(Math.floor(limit), 10_000))
    const result = await db.prepare(`SELECT ${JOB_COLUMNS} FROM ${safeTable(env?.JOB_TABLE ?? env?.JOBSTORE_TABLE)} WHERE lifecycle_status = 'active' LIMIT ${safeLimit}`).all<Record<string, unknown>>()
    const rows = result.results ?? []
    const normalized = rows.map(normalizeJob).filter((job): job is Job => Boolean(job))
    return normalized
  } catch (error) {
    // Log only the error class; never print query text or credentials.
    console.warn('D1 jobstore unavailable', error instanceof Error ? error.message : 'query failed')
    return null
  }
}

const parsePositive = (value: string | undefined, fallback: number, max: number) => {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? Math.min(Math.floor(parsed), max) : fallback
}

type JobSource = { jobs: Job[]; source: 'd1' | 'unavailable' }

type JobPageFilters = { country?: string; search?: string; role?: string }
type JobPage = { jobs: Job[]; total: number; countries: string[]; roles: string[] }

type CatalogOptions = Pick<JobPage, 'countries' | 'roles'>
type SitemapJob = Pick<Job, 'id' | 'company' | 'role' | 'dateModified'>

const CATALOG_OPTIONS_TTL_MS = 5 * 60 * 1_000
const ROLE_FILTERS = ['Engineer', 'Design', 'Product', 'Data', 'AI', 'Security', 'DevOps', 'SRE', 'QA', 'Mobile', 'Manager', 'Intern']
const catalogOptionsCache = new WeakMap<D1DatabaseLike, Map<string, { expiresAt: number; value: CatalogOptions }>>()
const catalogOptionsInFlight = new WeakMap<D1DatabaseLike, Map<string, Promise<CatalogOptions>>>()

const ftsPrefixQuery = (value: string) => Array.from(new Set(
  value.toLowerCase().match(/[\p{L}\p{N}+#.-]{2,}/gu) ?? [],
)).slice(0, 8).map((term) => `"${term.replace(/"/g, '""')}"*`).join(' AND ')

const pageWhere = (filters: JobPageFilters) => {
  const clauses = ["lifecycle_status = 'active'"]
  const params: unknown[] = []
  if (filters.country?.trim()) { clauses.push('country = ? COLLATE NOCASE'); params.push(filters.country.trim()) }
  const roleQuery = filters.role?.trim() ? ftsPrefixQuery(filters.role) : ''
  if (roleQuery) {
    clauses.push('rowid IN (SELECT rowid FROM job_search_fts WHERE job_search_fts MATCH ?)')
    params.push(roleQuery)
  }
  const search = filters.search?.trim() || ''
  const ftsQuery = search.length >= 2 ? ftsPrefixQuery(search) : ''
  if (ftsQuery) {
    clauses.push('rowid IN (SELECT rowid FROM job_search_fts WHERE job_search_fts MATCH ?)')
    params.push(ftsQuery)
  }
  return { where: clauses.join(' AND '), params }
}

const pageOrder = (filters: JobPageFilters) => {
  const search = filters.search?.trim() || ''
  const tokens = Array.from(new Set(search.toLowerCase().match(/[\p{L}\p{N}+#.-]{2,}/gu) ?? [])).slice(0, 8)
  if (search.length < 2 || tokens.length === 0) return { order: 'posted_at DESC, updated_at DESC', params: [] as unknown[] }
  const allTitleTokens = tokens.map(() => 'title LIKE ? COLLATE NOCASE').join(' AND ')
  return {
    order: `CASE WHEN title = ? COLLATE NOCASE THEN 0 WHEN title LIKE ? COLLATE NOCASE THEN 1 WHEN ${allTitleTokens} THEN 2 ELSE 3 END, posted_at DESC, updated_at DESC`,
    params: [search, `%${search}%`, ...tokens.map((token) => `%${token}%`)],
  }
}

const distinctValues = (rows: Record<string, unknown>[] | undefined, key: string, limit: number) => Array.from(new Set((rows ?? []).map((row) => asText(row[key]).trim()).filter(Boolean))).slice(0, limit)

const readCatalogOptions = async (db: D1DatabaseLike, table: string): Promise<CatalogOptions> => {
  const cache = catalogOptionsCache.get(db) ?? new Map<string, { expiresAt: number; value: CatalogOptions }>()
  const inFlight = catalogOptionsInFlight.get(db) ?? new Map<string, Promise<CatalogOptions>>()
  catalogOptionsCache.set(db, cache)
  catalogOptionsInFlight.set(db, inFlight)
  const cached = cache.get(table)
  if (cached && cached.expiresAt > Date.now()) return cached.value
  const existing = inFlight.get(table)
  if (existing) return existing
  const request = db.prepare(`SELECT DISTINCT country AS value FROM ${table} WHERE lifecycle_status = 'active' AND country IS NOT NULL AND country != '' ORDER BY country LIMIT 200`).all<Record<string, unknown>>().then((countryRows) => {
    const value = {
      countries: distinctValues(countryRows.results, 'value', 200),
      roles: [...ROLE_FILTERS],
    }
    cache.set(table, { expiresAt: Date.now() + CATALOG_OPTIONS_TTL_MS, value })
    return value
  }).finally(() => inFlight.delete(table))
  inFlight.set(table, request)
  return request
}

async function readD1JobPage(env: Bindings | undefined, page: number, pageSize: number, filters: JobPageFilters): Promise<JobPage | null> {
  const db = getDb(env)
  if (!db) return null
  try {
    const table = safeTable(env?.JOB_TABLE ?? env?.JOBSTORE_TABLE)
    const { where, params } = pageWhere(filters)
    const { order, params: orderParams } = pageOrder(filters)
    const offset = (page - 1) * pageSize
    const [countResult, rowsResult, options] = await Promise.all([
      db.prepare(`SELECT COUNT(*) AS total FROM ${table} WHERE ${where}`).bind(...params).all<Record<string, unknown>>(),
      db.prepare(`SELECT ${JOB_COLUMNS} FROM ${table} WHERE ${where} ORDER BY ${order} LIMIT ? OFFSET ?`).bind(...params, ...orderParams, pageSize, offset).all<Record<string, unknown>>(),
      readCatalogOptions(db, table),
    ])
    const total = Number(countResult.results?.[0]?.total ?? 0)
    const jobs = (rowsResult.results ?? []).map(normalizeJob).filter((job): job is Job => Boolean(job))
    return { jobs, total, ...options }
  } catch (error) {
    console.warn('D1 paginated jobstore unavailable', error instanceof Error ? error.message : 'query failed')
    return null
  }
}

export async function countD1SitemapJobs(env: Bindings | undefined): Promise<number | null> {
  const db = getDb(env)
  if (!db) return null
  try {
    const table = safeTable(env?.JOB_TABLE ?? env?.JOBSTORE_TABLE)
    const result = await db.prepare(`SELECT COUNT(*) AS total FROM ${table} WHERE lifecycle_status = 'active'`).all<Record<string, unknown>>()
    const total = Number(result.results?.[0]?.total)
    return Number.isSafeInteger(total) && total >= 0 ? total : null
  } catch {
    return null
  }
}

export async function readD1SitemapJobs(env: Bindings | undefined, page: number, pageSize: number): Promise<SitemapJob[] | null> {
  const db = getDb(env)
  if (!db) return null
  try {
    const table = safeTable(env?.JOB_TABLE ?? env?.JOBSTORE_TABLE)
    const safePage = Math.max(1, Math.floor(page))
    const safePageSize = Math.max(1, Math.min(Math.floor(pageSize), 5_000))
    const offset = (safePage - 1) * safePageSize
    const result = await db.prepare(`SELECT job_id, company, title, updated_at FROM ${table} WHERE lifecycle_status = 'active' ORDER BY job_id LIMIT ? OFFSET ?`).bind(safePageSize, offset).all<Record<string, unknown>>()
    return (result.results ?? []).map((row): SitemapJob | null => {
      const id = asText(row.job_id).trim()
      const company = asText(row.company).trim()
      const role = asText(row.title).trim()
      if (!id || !company || !role) return null
      return { id, company, role, dateModified: isoDate(row.updated_at) }
    }).filter((job): job is SitemapJob => Boolean(job))
  } catch {
    return null
  }
}

const resolveCatalogCountry = async (env: Bindings | undefined, visitorCountry: string) => {
  const db = getDb(env)
  if (!db || !visitorCountry) return ''
  try {
    const table = safeTable(env?.JOB_TABLE ?? env?.JOBSTORE_TABLE)
    const result = await db.prepare(`SELECT country AS value FROM ${table} WHERE lifecycle_status = 'active' AND LOWER(country) = LOWER(?) LIMIT 1`).bind(visitorCountry).all<Record<string, unknown>>()
    return asText(result.results?.[0]?.value).trim()
  } catch {
    return ''
  }
}

async function readD1JobById(env: Bindings | undefined, id: string): Promise<Job | null> {
  const db = getDb(env)
  if (!db) return null
  try {
    const table = safeTable(env?.JOB_TABLE ?? env?.JOBSTORE_TABLE)
    const result = await db.prepare(`SELECT ${JOB_COLUMNS} FROM ${table} WHERE lifecycle_status = 'active' AND CAST(job_id AS TEXT) = ? LIMIT 1`).bind(id).all<Record<string, unknown>>()
    return result.results?.[0] ? normalizeJob(result.results[0]) : null
  } catch (error) {
    console.warn('D1 job detail unavailable', error instanceof Error ? error.message : 'query failed')
    return null
  }
}

async function readD1JobsByIds(env: Bindings | undefined, ids: string[]): Promise<Job[]> {
  const db = getDb(env)
  const uniqueIds = Array.from(new Set(ids.filter(Boolean))).slice(0, 8)
  if (!db || uniqueIds.length === 0) return []
  try {
    const table = safeTable(env?.JOB_TABLE ?? env?.JOBSTORE_TABLE)
    const placeholders = uniqueIds.map(() => '?').join(', ')
    const result = await db.prepare(`SELECT ${JOB_COLUMNS} FROM ${table} WHERE lifecycle_status = 'active' AND CAST(job_id AS TEXT) IN (${placeholders})`).bind(...uniqueIds).all<Record<string, unknown>>()
    return (result.results ?? []).map(normalizeJob).filter((job): job is Job => Boolean(job))
  } catch {
    return []
  }
}

const loadJobs = async (env: Bindings | undefined): Promise<JobSource> => {
  const boundJobs = await readD1Jobs(env)
  if (boundJobs) return { jobs: boundJobs, source: 'd1' }
  return { jobs: [], source: 'unavailable' }
}

const authBindings = (env: Bindings | undefined): AuthBindings => {
  const database = env?.AUTH_DB
  if (!database) throw new Error('Authentication database is not configured')
  return {
    AUTH_DB: database,
    BETTER_AUTH_SECRET: env?.BETTER_AUTH_SECRET || '',
    BETTER_AUTH_URL: env?.BETTER_AUTH_URL || '',
    BETTER_AUTH_TRUSTED_ORIGINS: env?.BETTER_AUTH_TRUSTED_ORIGINS,
    GOOGLE_CLIENT_ID: env?.GOOGLE_CLIENT_ID || '',
    GOOGLE_CLIENT_SECRET: env?.GOOGLE_CLIENT_SECRET || '',
  }
}

const searchTokens = (value: string | null, max = 8) => Array.from(new Set((value?.toLowerCase().match(/[\p{L}\p{N}+#.-]{2,}/gu) ?? []).filter((term) => !['job', 'jobs', 'role', 'roles', 'opening', 'openings'].includes(term)))).slice(0, max)
const searchAiJobs = async (search: AiJobSearch, env: Bindings): Promise<AiJobSearchResult> => {
  if (search.intent === 'out_of_scope') return { jobs: [], total: 0, truncated: false }
  const db = getDb(env)
  if (!db) throw new Error('Job database is unavailable')
  const table = safeTable(env.JOB_TABLE ?? env.JOBSTORE_TABLE)
  const indexClauses = ['is_duplicate = 0']
  const params: unknown[] = []
  if (search.remote === true) indexClauses.push("canonical_work_mode = 'remote'")
  else if (search.remote === false) indexClauses.push("canonical_work_mode IN ('hybrid', 'on-site')")
  if (search.employmentType) { indexClauses.push('LOWER(canonical_employment_type) LIKE LOWER(?)'); params.push(`%${search.employmentType}%`) }
  const clauses = ["lifecycle_status = 'active'", `job_id IN (SELECT job_id FROM job_search_index WHERE ${indexClauses.join(' AND ')})`]
  if (search.location) {
    const location = `%${search.location}%`
    clauses.push('(LOWER(country) = LOWER(?) OR LOWER(location_raw) LIKE LOWER(?) OR LOWER(city) LIKE LOWER(?) OR LOWER(state) LIKE LOWER(?))')
    params.push(search.location, location, location, location)
  }
  for (const term of searchTokens(search.role, 6)) { clauses.push('LOWER(title) LIKE ?'); params.push(`%${term}%`) }
  if (search.company) { clauses.push('LOWER(company) LIKE LOWER(?)'); params.push(`%${search.company}%`) }
  if (search.seniority) { clauses.push('LOWER(seniority) LIKE LOWER(?)'); params.push(`%${search.seniority}%`) }
  const keywords = search.keywords.flatMap((value) => searchTokens(value, 3)).slice(0, 8)
  if (keywords.length) {
    const ftsQuery = keywords.map((term) => `"${term.replace(/"/g, '""')}"`).join(' AND ')
    clauses.push('rowid IN (SELECT rowid FROM job_search_fts WHERE job_search_fts MATCH ?)')
    params.push(ftsQuery)
  }
  const where = clauses.join(' AND ')
  const limit = search.allMatches ? 50 : 12
  const rolePhrase = search.role?.trim() || ''
  const order = search.sort === 'relevance' && rolePhrase ? 'CASE WHEN LOWER(title) = LOWER(?) THEN 0 WHEN LOWER(title) LIKE LOWER(?) THEN 1 ELSE 2 END, COALESCE(posted_at, updated_at) DESC' : 'COALESCE(posted_at, updated_at) DESC'
  const orderParams = search.sort === 'relevance' && rolePhrase ? [rolePhrase, `%${rolePhrase}%`] : []
  const countResult = await db.prepare(`SELECT COUNT(*) AS total FROM ${table} WHERE ${where}`).bind(...params).all<Record<string, unknown>>()
  const total = Number(countResult.results?.[0]?.total ?? 0)
  const rows = await db.prepare(`SELECT ${JOB_COLUMNS} FROM ${table} WHERE ${where} ORDER BY ${order} LIMIT ?`).bind(...params, ...orderParams, limit).all<Record<string, unknown>>()
  const jobs = (rows.results ?? []).map((row): AiJobContext | null => {
    const job = normalizeJob(row)
    return job ? {
      id: job.id,
      company: job.company,
      role: job.role,
      locations: job.locations,
      compensation: job.compensation,
      applyUrl: safeHttpsUrl(job.applyUrl, allowedApplyHosts(env)),
      description: [job.description, ...job.responsibilities, ...job.requirements].filter(Boolean).join('\n').slice(0, 2_500),
      workMode: asText(row.work_mode),
      employmentType: asText(row.employment_type),
    } : null
  }).filter((job): job is AiJobContext => Boolean(job))
  return { jobs, total, truncated: total > jobs.length }
}

const aiQuotaStore = createD1AiQuotaStore<Bindings>((env) => env.AUTH_DB as unknown as AiQuotaDatabase | undefined)
const aiHandlers = createAiChatHandlers<Bindings>({
  authenticate: async (request, env) => {
    const session = await getAuthSession(request, authBindings(env))
    return session?.user?.id ? { id: session.user.id } : null
  },
  searchJobs: searchAiJobs,
  quotaStore: aiQuotaStore,
})

const boolSetting = (value: string | undefined, fallback: boolean) => value == null ? fallback : /^(1|true|yes|on)$/i.test(value)
const filterValue = (value: string | undefined, maxLength: number) => {
  const normalized = value?.trim() || ''
  return normalized.length <= maxLength ? normalized : null
}
const allowedApplyHosts = (env: Bindings | undefined) => (env?.APPLY_URL_HOSTS || '').split(',').map((host) => host.trim().toLowerCase()).filter(Boolean)
const sanitizeJob = (job: Job, env: Bindings | undefined): Job => ({ ...job, applyUrl: safeHttpsUrl(job.applyUrl, allowedApplyHosts(env)) })
const summarizeJob = (job: Job, env: Bindings | undefined): Job => ({
  ...sanitizeJob(job, env),
  applyUrl: '',
  description: '',
  companyAbout: '',
  responsibilities: [],
  requirements: [],
  benefits: [],
  extras: [],
})
const searchSource = (job: Job, env: Bindings | undefined) => {
  const safe = sanitizeJob(job, env)
  return { id: safe.id, company: safe.company, role: safe.role, locations: safe.locations, applyUrl: safe.applyUrl }
}
const etag = (payload: unknown) => {
  const input = JSON.stringify(payload)
  let hash = 2166136261
  for (let index = 0; index < input.length; index += 1) hash = Math.imul(hash ^ input.charCodeAt(index), 16777619)
  return `W/"${(hash >>> 0).toString(16)}-${input.length}"`
}
const cacheJson = (c: any, payload: unknown, policy = 'public, max-age=60, stale-while-revalidate=300') => {
  const tag = etag(payload)
  c.header('Cache-Control', policy)
  c.header('ETag', tag)
  if (c.req.header('If-None-Match') === tag) return c.body(null, 304)
  return c.json(payload)
}
const cookieValue = (header: string, name: string) => header.split(';').map((part) => part.trim()).find((part) => part.startsWith(`${name}=`))?.slice(name.length + 1) || ''
const clientIdentity = (c: any, issueSession = false) => {
  const ip = (c.req.header('CF-Connecting-IP') || 'local').trim().slice(0, 128)
  let session = cookieValue(c.req.header('Cookie') || '', 'fmj_session').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 64)
  if (!session && issueSession) {
    session = requestId().replace(/-/g, '')
    c.header('Set-Cookie', `fmj_session=${session}; Path=/; Max-Age=86400; HttpOnly; Secure; SameSite=Lax`)
  }
  return { ip, session }
}
const consumeRateLimit = async (c: any, limiter: RateLimitLike | undefined, scope: string, includeSession = false) => {
  if (!limiter) return true
  const identity = clientIdentity(c, includeSession)
  const checks = [limiter.limit({ key: `${scope}:ip:${identity.ip}` })]
  if (includeSession && identity.session) checks.push(limiter.limit({ key: `${scope}:session:${identity.session}` }))
  return (await Promise.all(checks)).every((result) => result.success)
}
const tooManyRequests = (c: any) => {
  c.header('Retry-After', '60')
  return c.json({ error: 'Too many requests. Please retry shortly.' }, 429)
}
const verifyTurnstile = async (c: any, token: string) => {
  const secret = c.env?.TURNSTILE_SECRET_KEY
  if (!secret) return !boolSetting(c.env?.TURNSTILE_REQUIRED, false)
  if (!token || token.length > 2048) return false
  try {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 5_000)
    const response = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ secret, response: token, remoteip: clientIdentity(c).ip }),
      signal: controller.signal,
    }).finally(() => clearTimeout(timer))
    if (!response.ok) return false
    const result = await response.json() as { success?: boolean; hostname?: string; action?: string }
    const expectedHost = new URL(c.req.url).hostname
    return result.success === true && result.hostname === expectedHost && result.action === 'semantic-search'
  } catch { return false }
}

app.get('/api/health', async (c) => {
  if (!await consumeRateLimit(c, c.env?.READ_RATE_LIMITER, 'health')) return tooManyRequests(c)
  return c.json({ ok: true, service: 'findmeajob' })
})

app.on(['GET', 'POST'], '/api/auth/*', async (c) => {
  try {
    return await handleAuthRequest(c.req.raw, authBindings(c.env))
  } catch (error) {
    console.warn('Authentication unavailable', error instanceof Error ? error.message : 'configuration error')
    return c.json({ error: 'Authentication is temporarily unavailable' }, 503)
  }
})

app.get('/api/ai/usage', (c) => aiHandlers.usage(c.req.raw, c.env))
app.post('/api/ai/chat', (c) => aiHandlers.chat(c.req.raw, c.env))

app.get('/api/logos/:slug', async (c) => {
  if (!await consumeRateLimit(c, c.env?.READ_RATE_LIMITER, 'logos')) return tooManyRequests(c)
  const slug = c.req.param('slug').trim().toLowerCase()
  if (!/^[a-z0-9-]+$/.test(slug)) return c.json({ error: 'Logo not found' }, 404)
  const key = await resolveLogoKey(c.env, slug)
  const object = key && c.env.COMPANY_LOGOS ? await c.env.COMPANY_LOGOS.get(key) : null
  if (!object?.body) return c.json({ error: 'Logo not found' }, 404)
  const extension = key?.split('.').pop()?.toLowerCase()
  const contentType = ({ png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp' } as Record<string, string>)[extension || '']
  if (!contentType) return c.json({ error: 'Logo not found' }, 404)
  const headers = new Headers({ 'Content-Type': contentType, 'Cache-Control': 'public, max-age=86400, stale-while-revalidate=604800' })
  if (object.httpEtag) headers.set('ETag', object.httpEtag)
  return new Response(object.body, { headers })
})

app.get('/api/jobs', async (c) => {
  if (!await consumeRateLimit(c, c.env?.READ_RATE_LIMITER, 'jobs-list')) return tooManyRequests(c)
  if (c.req.url.length > 2_048) return c.json({ error: 'Query string is too long' }, 414)
  const query = new URL(c.req.url).searchParams
  const allowedQuery = new Set(['country', 'search', 'role', 'page', 'pageSize'])
  if (Array.from(query.keys()).some((key) => !allowedQuery.has(key) || query.getAll(key).length > 1)) return c.json({ error: 'Invalid query parameters' }, 400)
  const requestedCountry = c.req.query('country')
  const explicitAllCountries = requestedCountry?.trim().toLowerCase() === 'all'
  let country = explicitAllCountries ? '' : filterValue(requestedCountry, 80)
  const search = filterValue(c.req.query('search'), 120)
  const role = filterValue(c.req.query('role'), 120)
  if (country == null || search == null || role == null) return c.json({ error: 'Invalid filter' }, 400)
  let countryAutoSelected = false
  if (requestedCountry == null) {
    const detectedCountry = visitorCountryName(c.req.raw)
    const catalogCountry = await resolveCatalogCountry(c.env, detectedCountry)
    if (catalogCountry) {
      country = catalogCountry
      countryAutoSelected = true
    }
  }
  const filters: JobPageFilters = { country, search, role }
  const pageSize = parsePositive(c.req.query('pageSize'), 40, 40)
  const page = parsePositive(c.req.query('page'), 1, 10_000)
  let result = await readD1JobPage(c.env, page, pageSize, filters)
  let source: 'd1' | 'unavailable' = result ? 'd1' : 'unavailable'
  if (result) {
    const totalPages = Math.max(1, Math.ceil(result.total / pageSize))
    const safePage = Math.min(page, totalPages)
    if (safePage !== page) {
      result = await readD1JobPage(c.env, safePage, pageSize, filters) ?? result
    }
    const jobs = result.jobs.map((job) => summarizeJob(job, c.env))
    return cacheJson(c, { data: jobs, jobs, total: result.total, page: safePage, pageSize, totalPages, source, filters, selectedCountry: country || '', countryAutoSelected, countries: result.countries, roles: result.roles })
  }
  // Keep a bounded fallback for local development without a D1 binding.
  const loaded = await loadJobs(c.env)
  const data = filterJobs(loaded.jobs, filters)
  const totalPages = Math.max(1, Math.ceil(data.length / pageSize))
  const safePage = Math.min(page, totalPages)
  const pageData = data.slice((safePage - 1) * pageSize, safePage * pageSize).map((job) => summarizeJob(job, c.env))
  const payload = { data: pageData, jobs: pageData, total: data.length, page: safePage, pageSize, totalPages, source: loaded.source, filters, selectedCountry: country || '', countryAutoSelected, countries: Array.from(new Set(loaded.jobs.flatMap((job) => job.locations))), roles: Array.from(new Set(loaded.jobs.map((job) => job.role))) }
  return loaded.source === 'unavailable' ? c.json(payload, 503) : cacheJson(c, payload)
})

app.get('/api/jobs/:id', async (c) => {
  if (!await consumeRateLimit(c, c.env?.READ_RATE_LIMITER, 'job-detail')) return tooManyRequests(c)
  const id = c.req.param('id').trim()
  if (!id || id.length > 128 || !/^[A-Za-z0-9_-]+$/.test(id)) return c.json({ error: 'Job not found' }, 404)
  const data = await readD1JobById(c.env, id)
  return data ? cacheJson(c, { data: sanitizeJob(data, c.env), source: 'd1' }) : c.json({ error: 'Job not found' }, 404)
})

async function voyageEmbedding(env: Bindings | undefined, query: string): Promise<number[] | null> {
  const key = env?.VOYAGE_API_KEY
  if (!key || !query.trim()) return null
  try {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 8_000)
    const response = await fetch('https://api.voyageai.com/v1/multimodalembeddings', {
      method: 'POST', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        inputs: [{ content: [{ type: 'text', text: query.trim() }] }],
        model: env?.VOYAGE_EMBED_MODEL || 'voyage-multimodal-3.5',
        input_type: 'query',
      }),
      signal: controller.signal,
    }).finally(() => clearTimeout(timer))
    if (!response.ok) return null
    const body = await response.json() as { data?: Array<{ embedding?: number[] }> }
    return body.data?.[0]?.embedding ?? null
  } catch { return null }
}

/** Rate-limited semantic search for the public jobs catalog. */
const semanticSearch = async (c: any) => {
  if (!boolSetting(c.env?.SEARCH_ENABLED, true)) return c.json({ error: 'Search is temporarily unavailable' }, 503)
  if (!await consumeRateLimit(c, c.env?.SEARCH_RATE_LIMITER, 'semantic-search', true)) return tooManyRequests(c)
  const contentType = (c.req.header('Content-Type') || '').toLowerCase()
  if (!contentType.startsWith('application/json')) return c.json({ error: 'Content-Type must be application/json' }, 415)
  const contentLength = Number(c.req.header('Content-Length') || 0)
  if (Number.isFinite(contentLength) && contentLength > 4_096) return c.json({ error: 'Request body is too large' }, 413)
  const raw = await c.req.raw.text()
  if (new TextEncoder().encode(raw).byteLength > 4_096) return c.json({ error: 'Request body is too large' }, 413)
  let body: Record<string, unknown>
  try { body = JSON.parse(raw) as Record<string, unknown> } catch { return c.json({ error: 'Malformed JSON' }, 400) }
  if (!body || Array.isArray(body) || typeof body !== 'object' || Object.keys(body).some((key) => !['query', 'limit'].includes(key))) return c.json({ error: 'Invalid request body' }, 400)
  const query = typeof body.query === 'string' ? body.query.trim() : ''
  const queryLength = Array.from(query).length
  if (queryLength < 2 || queryLength > 500) return c.json({ error: 'Query must be between 2 and 500 characters' }, 400)
  const requestedLimit = body.limit == null ? 8 : body.limit
  if (!Number.isInteger(requestedLimit) || Number(requestedLimit) < 1 || Number(requestedLimit) > 8) return c.json({ error: 'Limit must be an integer between 1 and 8' }, 400)
  const limit = Number(requestedLimit)
  if (boolSetting(c.env?.TURNSTILE_REQUIRED, false)) {
    const token = c.req.header('CF-Turnstile-Response') || ''
    if (!await verifyTurnstile(c, token)) return c.json({ error: 'Human verification failed' }, 403)
  }
  const index = getVectorIndex(c.env)
  const embedding = await voyageEmbedding(c.env, query)
  if (index && embedding) {
    try {
      const result = await index.query(embedding, { topK: limit, returnMetadata: 'all', namespace: 'active' })
      const ranked = (result.matches ?? []).map((match) => ({
        match,
        jobId: asText(match.metadata?.job_id) || asText(match.id).replace(/^job:/, ''),
      })).filter((entry) => entry.jobId)
      const jobs = await readD1JobsByIds(c.env, ranked.map((entry) => entry.jobId))
      const jobsById = new Map(jobs.map((job) => [job.id, job]))
      const matches = ranked.map(({ match, jobId }) => {
        const job = jobsById.get(jobId)
        return job ? { id: job.id, score: match.score, metadata: searchSource(job, c.env) } : null
      }).filter(Boolean)
      if (matches.length > 0) return c.json({ matches, source: 'vectorize' })
    } catch (error) {
      console.warn('Vectorize retrieval unavailable; using text search', error instanceof Error ? error.message : 'query failed')
    }
  }
  const loaded = await loadJobs(c.env)
  const terms = query.toLowerCase().split(/\s+/).filter((term) => term.length > 2)
  const fallback = loaded.jobs.map((job) => {
    const haystack = `${job.company} ${job.role} ${job.description} ${job.companyAbout} ${job.responsibilities.join(' ')} ${job.requirements.join(' ')} ${job.benefits.join(' ')} ${job.extras.join(' ')} ${job.locations.join(' ')} ${job.compensation.join(' ')}`.toLowerCase()
    const hits = terms.filter((term) => haystack.includes(term)).length
    return { job, hits }
  }).filter((entry) => entry.hits > 0).sort((a, b) => b.hits - a.hits).slice(0, limit)
  return c.json({ matches: fallback.map(({ job, hits }) => ({ id: job.id, score: hits / Math.max(terms.length, 1), metadata: searchSource(job, c.env) })), source: loaded.source === 'd1' ? 'd1-text' : 'unavailable-text' })
}
app.post('/api/jobs/search', semanticSearch)

app.notFound((c) => c.json({ error: 'Not found' }, 404))

export { app }
export default app
