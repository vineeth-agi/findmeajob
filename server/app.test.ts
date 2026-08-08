import assert from 'node:assert/strict'
import test from 'node:test'
import app, { type Bindings } from './app.js'

const sampleRow = {
  job_id: 'job-123',
  company: 'Example Co',
  company_slug: 'example-co',
  title: 'Design Engineer',
  location_raw: 'Remote, United States',
  country: 'United States',
  salary_min: 100000,
  salary_max: 140000,
  salary_currency: 'USD',
  apply_url_final_url: 'https://jobs.example.com/apply/123',
  role_overview: 'Build safe products.',
  company_about: 'A test company.',
  structured_json: JSON.stringify({ responsibilities: ['Ship features'], requirements: ['Be kind'] }),
  posted_at: Date.now(),
  updated_at: Date.now(),
}

const mockDb = (catalogCountry = 'United States') => {
  const queries: string[] = []
  const database = {
    prepare(query: string) {
      queries.push(query)
      let boundValues: unknown[] = []
      const statement = {
        bind(...values: unknown[]) { boundValues = values; return statement },
        async all() {
          if (/SELECT country AS value/i.test(query) && /LOWER\(country\)/i.test(query)) {
            const requestedCountry = String(boundValues[0] ?? '')
            return { results: requestedCountry.toLowerCase() === catalogCountry.toLowerCase() ? [{ value: catalogCountry }] : [] }
          }
          if (/COUNT\(\*\)/i.test(query)) return { results: [{ total: 1 }] }
          if (/DISTINCT country/i.test(query)) return { results: [{ value: catalogCountry }] }
          if (/DISTINCT title/i.test(query)) return { results: [{ value: 'Design Engineer' }] }
          return { results: [sampleRow] }
        },
      }
      return statement
    },
  }
  return { database: database as unknown as NonNullable<Bindings['JOBSTORE']>, queries }
}

test('health is a cheap liveness response with security headers', async () => {
  const response = await app.request('https://example.com/api/health')
  assert.equal(response.status, 200)
  assert.deepEqual(await response.json(), { ok: true, service: 'findmeajob' })
  assert.equal(response.headers.get('x-content-type-options'), 'nosniff')
  assert.equal(response.headers.get('cache-control'), 'no-store')
  assert.equal(response.headers.get('x-robots-tag'), 'noindex, nofollow, noarchive')
  assert.equal(response.headers.get('cross-origin-resource-policy'), 'same-origin')
})

test('auth and AI routes fail closed when unsigned or unconfigured', async () => {
  const usage = await app.request('https://example.com/api/ai/usage')
  assert.equal(usage.status, 401)
  assert.deepEqual(await usage.json(), { error: 'Authentication required' })

  const auth = await app.request('https://example.com/api/auth/get-session')
  assert.equal(auth.status, 503)
  assert.deepEqual(await auth.json(), { error: 'Authentication is temporarily unavailable' })
})

test('cross-origin API requests are denied unless explicitly allowlisted', async () => {
  const denied = await app.request('https://example.com/api/health', { headers: { Origin: 'https://evil.example' } })
  assert.equal(denied.status, 403)
  const allowed = await app.request('https://example.com/api/health', { headers: { Origin: 'https://app.example' } }, { ALLOWED_ORIGINS: 'https://app.example' })
  assert.equal(allowed.status, 200)
  assert.equal(allowed.headers.get('access-control-allow-origin'), 'https://app.example')
})

test('unexpected methods and search content types are rejected', async () => {
  const method = await app.request('https://example.com/api/jobs', { method: 'DELETE' })
  assert.equal(method.status, 405)
  assert.equal(method.headers.get('allow'), 'GET')
  const media = await app.request('https://example.com/api/jobs/search', { method: 'POST', body: 'query=test' })
  assert.equal(media.status, 415)
})

test('catalog rejects unknown or repeated query parameters', async () => {
  const unknown = await app.request('https://example.com/api/jobs?page=1&download=all')
  assert.equal(unknown.status, 400)
  const repeated = await app.request('https://example.com/api/jobs?page=1&page=2')
  assert.equal(repeated.status, 400)
})

test('semantic search validates its exact bounded schema', async () => {
  const invalid = await app.request('https://example.com/api/jobs/search', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: 'valid query', limit: 8, unexpected: true }),
  })
  assert.equal(invalid.status, 400)
  const large = await app.request('https://example.com/api/jobs/search', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Content-Length': '5000' },
    body: JSON.stringify({ query: 'valid query' }),
  })
  assert.equal(large.status, 413)
})

test('search rate limiter rejects before an upstream call', async () => {
  const response = await app.request('https://example.com/api/jobs/search', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: 'valid query' }),
  }, { SEARCH_RATE_LIMITER: { limit: async () => ({ success: false }) } })
  assert.equal(response.status, 429)
  assert.equal(response.headers.get('retry-after'), '60')
})

test('semantic search queries the active Vectorize namespace and hydrates jobs from D1', async () => {
  const originalFetch = globalThis.fetch
  let queryOptions: Record<string, unknown> | undefined
  globalThis.fetch = async (input: string | URL | Request) => {
    if (String(input).startsWith('https://api.voyageai.com/')) {
      return new Response(JSON.stringify({ data: [{ embedding: [0.1, 0.2, 0.3] }] }), { headers: { 'Content-Type': 'application/json' } })
    }
    return originalFetch(input)
  }
  try {
    const { database } = mockDb()
    const vectorize = {
      async query(_vector: number[], options?: Record<string, unknown>) {
        queryOptions = options
        return { matches: [{ id: 'job:job-123', score: 0.92, metadata: { job_id: 'job-123' } }] }
      },
    } as NonNullable<Bindings['VECTORIZE']>
    const response = await app.request('https://example.com/api/jobs/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: 'design engineer', limit: 5 }),
    }, { JOBSTORE: database, VECTORIZE: vectorize, VOYAGE_API_KEY: 'test-voyage-key' })
    assert.equal(response.status, 200)
    const payload = await response.json() as { source?: string; matches?: Array<{ id?: string; metadata?: { company?: string } }> }
    assert.equal(queryOptions?.namespace, 'active')
    assert.equal(payload.source, 'vectorize')
    assert.equal(payload.matches?.[0]?.id, 'job-123')
    assert.equal(payload.matches?.[0]?.metadata?.company, 'Example Co')
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('catalog pages use explicit columns and expose summaries only', async () => {
  const { database, queries } = mockDb()
  const response = await app.request('https://example.com/api/jobs?page=1&pageSize=40', {}, { JOBSTORE: database })
  assert.equal(response.status, 200)
  const payload = await response.json() as { jobs: Array<Record<string, unknown>> }
  assert.equal(payload.jobs.length, 1)
  assert.equal(payload.jobs[0].company, 'Example Co')
  assert.equal(payload.jobs[0].description, '')
  assert.equal(payload.jobs[0].applyUrl, '')
  assert.deepEqual(payload.jobs[0].responsibilities, [])
  assert.equal(response.headers.get('cache-control'), 'public, max-age=60, stale-while-revalidate=300')
  assert.ok(response.headers.get('etag'))
  assert.equal(queries.some((query) => /SELECT\s+\*/i.test(query)), false)
})

test('catalog text search uses the FTS index instead of scanning long prose columns', async () => {
  const { database, queries } = mockDb()
  const response = await app.request('https://example.com/api/jobs?search=design%20engineer&page=1&pageSize=40', {}, { JOBSTORE: database })
  assert.equal(response.status, 200)
  assert.ok(queries.some((query) => /job_search_fts\s+MATCH/i.test(query)))
  assert.ok(queries.some((query) => /CASE WHEN title = \?/i.test(query)))
  assert.equal(queries.some((query) => /LOWER\(role_overview\)\s+LIKE/i.test(query)), false)
})

test('catalog defaults to the visitor country when that country has active jobs', async () => {
  const { database } = mockDb('India')
  const response = await app.request('https://example.com/api/jobs?page=1&pageSize=40', {
    headers: { 'CF-IPCountry': 'IN' },
  }, { JOBSTORE: database })
  assert.equal(response.status, 200)
  const payload = await response.json() as { selectedCountry?: string; countryAutoSelected?: boolean; filters?: { country?: string } }
  assert.equal(payload.selectedCountry, 'India')
  assert.equal(payload.countryAutoSelected, true)
  assert.equal(payload.filters?.country, 'India')
})

test('catalog falls back to all countries and an explicit all selection disables geolocation', async () => {
  const unsupportedDb = mockDb('United States')
  const unsupported = await app.request('https://example.com/api/jobs?page=1&pageSize=40', {
    headers: { 'CF-IPCountry': 'AQ' },
  }, { JOBSTORE: unsupportedDb.database })
  const unsupportedPayload = await unsupported.json() as { selectedCountry?: string; countryAutoSelected?: boolean; filters?: { country?: string } }
  assert.equal(unsupportedPayload.selectedCountry, '')
  assert.equal(unsupportedPayload.countryAutoSelected, false)
  assert.equal(unsupportedPayload.filters?.country, '')

  const explicitDb = mockDb('India')
  const explicit = await app.request('https://example.com/api/jobs?country=all&page=1&pageSize=40', {
    headers: { 'CF-IPCountry': 'IN' },
  }, { JOBSTORE: explicitDb.database })
  const explicitPayload = await explicit.json() as { selectedCountry?: string; countryAutoSelected?: boolean; filters?: { country?: string } }
  assert.equal(explicitPayload.selectedCountry, '')
  assert.equal(explicitPayload.countryAutoSelected, false)
  assert.equal(explicitPayload.filters?.country, '')
})

test('an unavailable catalog is not cached as a successful empty result', async () => {
  const response = await app.request('https://example.com/api/jobs?page=1&pageSize=40')
  assert.equal(response.status, 503)
  assert.equal(response.headers.get('cache-control'), 'no-store')
  const payload = await response.json() as { source?: string; jobs?: unknown[] }
  assert.equal(payload.source, 'unavailable')
  assert.deepEqual(payload.jobs, [])
})

test('job detail preserves full data but rejects unsafe application URLs', async () => {
  const { database } = mockDb()
  const safe = await app.request('https://example.com/api/jobs/job-123', {}, { JOBSTORE: database })
  const payload = await safe.json() as { data: Record<string, unknown> }
  assert.equal(payload.data.description, 'Build safe products.')
  assert.equal(payload.data.applyUrl, 'https://jobs.example.com/apply/123')

  const unsafeDb = mockDb()
  const originalPrepare = (unsafeDb.database as any).prepare.bind(unsafeDb.database)
  ;(unsafeDb.database as any).prepare = (query: string) => {
    const statement = originalPrepare(query)
    if (/CAST\(job_id AS TEXT\)/i.test(query)) statement.all = async () => ({ results: [{ ...sampleRow, apply_url_final_url: 'javascript:alert(1)' }] })
    return statement
  }
  const unsafe = await app.request('https://example.com/api/jobs/job-123', {}, { JOBSTORE: unsafeDb.database })
  const unsafePayload = await unsafe.json() as { data: Record<string, unknown> }
  assert.equal(unsafePayload.data.applyUrl, '')
})

test('logo endpoint resolves a complete hyphenated company slug from R2', async () => {
  let requestedKey = ''
  const bucket = {
    async list() {
      return { objects: [{ key: '123456-sequoia-capital.png' }], truncated: false }
    },
    async get(key: string) {
      requestedKey = key
      return { body: 'png-data', httpMetadata: { contentType: 'image/png' }, httpEtag: 'test-etag' }
    },
  } as unknown as NonNullable<Bindings['COMPANY_LOGOS']>
  const response = await app.request('https://example.com/api/logos/sequoia-capital', {}, { COMPANY_LOGOS: bucket })
  assert.equal(response.status, 200)
  assert.equal(requestedKey, '123456-sequoia-capital.png')
  assert.equal(response.headers.get('content-type'), 'image/png')
  assert.equal(await response.text(), 'png-data')
})
