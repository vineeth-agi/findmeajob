import assert from 'node:assert/strict'
import test from 'node:test'
import { createAiChatHandlers, type AiQuotaReservation, type AiQuotaStore } from './ai-chat.js'

type Env = { OPENAI_API_KEY?: string; OPENAI_AI_MODEL?: string; AI_RATE_LIMITER?: { limit: (options: { key: string }) => Promise<{ success: boolean }> } }

class MemoryQuota implements AiQuotaStore<Env> {
  used = 0
  reservations = new Set<string>()
  async reserve(_env: Env, userId: string, dayUtc: string, _nowEpochSeconds: number) {
    if (this.used + this.reservations.size >= 200) return null
    const id = `reservation-${this.reservations.size + 1}`
    this.reservations.add(id)
    return { id, userId, dayUtc }
  }
  async commit(_env: Env, reservation: AiQuotaReservation) {
    if (!this.reservations.delete(reservation.id)) return null
    this.used += 1
    return this.used
  }
  async release(_env: Env, reservation: AiQuotaReservation) { this.reservations.delete(reservation.id) }
  async status() { return { used: this.used, inFlight: this.reservations.size } }
}

const request = (body: unknown) => new Request('https://example.com/api/ai/chat', {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
})

const completedResponse = (text = 'A completed answer') => new Response(JSON.stringify({
  id: 'resp_test', status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text }] }],
}), { status: 200, headers: { 'Content-Type': 'application/json' } })
const toolCallResponse = (argumentsValue: Record<string, unknown> = {}) => new Response(JSON.stringify({
  id: 'resp_tool', status: 'completed', output: [{ type: 'function_call', call_id: 'call_search', name: 'search_jobs', arguments: JSON.stringify({
    intent: 'job_search', role: null, location: null, remote: null, company: null, keywords: [], seniority: null, employmentType: null, sort: 'relevance', allMatches: false, ...argumentsValue,
  }) }],
}), { status: 200, headers: { 'Content-Type': 'application/json' } })

test('anonymous requests are rejected before retrieval or OpenAI', async () => {
  let fetched = false
  const handlers = createAiChatHandlers<Env>({
    authenticate: async () => null,
    searchJobs: async () => { throw new Error('must not run') },
    quotaStore: new MemoryQuota(),
    fetch: async () => { fetched = true; return completedResponse() },
  })
  const response = await handlers.chat(request({ query: 'Find a role' }), { OPENAI_API_KEY: 'server-secret' })
  assert.equal(response.status, 401)
  assert.equal(fetched, false)
})

test('obvious non-job requests are refused before quota reservation or OpenAI', async () => {
  const quota = new MemoryQuota()
  let upstreamCalls = 0
  let searchCalls = 0
  const handlers = createAiChatHandlers<Env>({
    authenticate: async () => ({ id: 'user-1' }),
    searchJobs: async () => { searchCalls += 1; return { jobs: [], total: 0, truncated: false } },
    quotaStore: quota,
    fetch: async () => { upstreamCalls += 1; return completedResponse('Must not run') },
    now: () => new Date('2026-08-08T12:00:00.000Z'),
  })
  const response = await handlers.chat(request({ query: 'Write a Python hello world program' }), { OPENAI_API_KEY: 'server-secret' })
  const payload = await response.json() as any
  const unrelatedSearchResponse = await handlers.chat(request({ query: 'Find the capital of France' }), { OPENAI_API_KEY: 'server-secret' })
  const unrelatedSearchPayload = await unrelatedSearchResponse.json() as any
  assert.equal(response.status, 200)
  assert.match(payload.answer, /only help search, filter, compare/i)
  assert.deepEqual(payload.usage, { limit: 200, used: 0, remaining: 200, resetsAt: '2026-08-09T00:00:00.000Z' })
  assert.equal(unrelatedSearchResponse.status, 200)
  assert.match(unrelatedSearchPayload.answer, /Findmeajob catalog/i)
  assert.equal(upstreamCalls, 0)
  assert.equal(searchCalls, 0)
  assert.equal(quota.used, 0)
  assert.equal(quota.reservations.size, 0)
})

test('ambiguous requests classified out of scope are not answered or counted', async () => {
  const quota = new MemoryQuota()
  let upstreamCalls = 0
  let searchCalls = 0
  const handlers = createAiChatHandlers<Env>({
    authenticate: async () => ({ id: 'user-1' }),
    searchJobs: async () => { searchCalls += 1; return { jobs: [], total: 0, truncated: false } },
    quotaStore: quota,
    fetch: async () => { upstreamCalls += 1; return toolCallResponse({ intent: 'out_of_scope' }) },
  })
  const response = await handlers.chat(request({ query: 'Give me general career advice' }), { OPENAI_API_KEY: 'server-secret' })
  const payload = await response.json() as any
  assert.equal(response.status, 200)
  assert.match(payload.answer, /Findmeajob catalog/i)
  assert.equal(upstreamCalls, 1)
  assert.equal(searchCalls, 0)
  assert.equal(quota.used, 0)
  assert.equal(quota.reservations.size, 0)
})

test('a completed non-empty answer is the only path that increments quota', async () => {
  const quota = new MemoryQuota()
  const upstreamBodies: any[] = []
  let upstreamCalls = 0
  const handlers = createAiChatHandlers<Env>({
    authenticate: async () => ({ id: 'better-auth-user-1' }),
    searchJobs: async () => ({ jobs: [{ id: 'job-1', company: 'Acme', role: 'Design Engineer', locations: ['Remote'], applyUrl: 'https://jobs.example.com/job-1' }], total: 1, truncated: false }),
    quotaStore: quota,
    fetch: async (_input, init) => { upstreamBodies.push(JSON.parse(String(init?.body))); upstreamCalls += 1; return upstreamCalls === 1 ? toolCallResponse({ role: 'design engineer', allMatches: true }) : completedResponse('Try Acme.') },
    now: () => new Date('2026-08-08T12:00:00.000Z'),
  })
  const response = await handlers.chat(request({ query: 'Find a design role', jobContext: 'Visible page: design jobs', history: [{ role: 'user', content: 'Remote roles in India' }, { role: 'assistant', content: 'I found one.' }] }), { OPENAI_API_KEY: 'server-secret' })
  assert.equal(response.status, 200)
  const payload = await response.json() as any
  assert.equal(payload.answer, 'Try Acme.')
  assert.equal(payload.usage.used, 1)
  assert.equal(payload.usage.remaining, 199)
  assert.equal(payload.usage.resetsAt, '2026-08-09T00:00:00.000Z')
  assert.deepEqual(payload.sources, [{ id: 'job-1', company: 'Acme', role: 'Design Engineer', location: 'Remote', locations: ['Remote'], applyUrl: 'https://jobs.example.com/job-1' }])
  assert.deepEqual(payload.matches, { total: 1, shown: 1, truncated: false })
  assert.equal(quota.used, 1)
  assert.equal(quota.reservations.size, 0)
  assert.equal(upstreamBodies.length, 2)
  assert.equal(upstreamBodies[0].model, 'gpt-5.6-luna')
  assert.equal(upstreamBodies[0].store, false)
  assert.equal(upstreamBodies[0].max_output_tokens, 500)
  assert.equal(upstreamBodies[1].max_output_tokens, 800)
  assert.equal(upstreamBodies[0].tools[0].strict, true)
  assert.match(upstreamBodies[0].instructions, /Allowed scope:/)
  assert.match(upstreamBodies[0].instructions, /intent out_of_scope/)
  assert.equal(upstreamBodies[0].safety_identifier.length, 64)
  assert.equal(JSON.stringify(upstreamBodies).includes('Visible page: design jobs'), true)
  assert.equal(JSON.stringify(upstreamBodies).includes('Remote roles in India'), true)
  assert.equal(JSON.stringify(upstreamBodies).includes('server-secret'), false)
})

test('OpenAI failures release the reservation and do not count', async () => {
  const quota = new MemoryQuota()
  const handlers = createAiChatHandlers<Env>({
    authenticate: async () => ({ id: 'user-1' }),
    searchJobs: async () => ({ jobs: [], total: 0, truncated: false }),
    quotaStore: quota,
    fetch: async () => new Response(JSON.stringify({ error: { message: 'upstream failure' } }), { status: 500 }),
  })
  const response = await handlers.chat(request({ query: 'Find a role' }), { OPENAI_API_KEY: 'server-secret' })
  assert.equal(response.status, 502)
  assert.equal(quota.used, 0)
  assert.equal(quota.reservations.size, 0)
})

test('invalid structured search calls fail without consuming quota', async () => {
  const quota = new MemoryQuota()
  let searchCalls = 0
  const handlers = createAiChatHandlers<Env>({
    authenticate: async () => ({ id: 'user-1' }),
    searchJobs: async () => { searchCalls += 1; return { jobs: [], total: 0, truncated: false } },
    quotaStore: quota,
    fetch: async () => completedResponse('Unstructured answer without the required tool call'),
  })
  const response = await handlers.chat(request({ query: 'Find remote React jobs' }), { OPENAI_API_KEY: 'server-secret' })
  assert.equal(response.status, 502)
  assert.equal(searchCalls, 0)
  assert.equal(quota.used, 0)
  assert.equal(quota.reservations.size, 0)
})

test('malformed structured filters are rejected instead of broadening the search', async () => {
  const quota = new MemoryQuota()
  let searchCalls = 0
  const handlers = createAiChatHandlers<Env>({
    authenticate: async () => ({ id: 'user-1' }),
    searchJobs: async () => { searchCalls += 1; return { jobs: [], total: 0, truncated: false } },
    quotaStore: quota,
    fetch: async () => toolCallResponse({ remote: 'yes', allMatches: 'yes' }),
  })
  const response = await handlers.chat(request({ query: 'Show all remote design jobs' }), { OPENAI_API_KEY: 'server-secret' })
  assert.equal(response.status, 502)
  assert.equal(searchCalls, 0)
  assert.equal(quota.used, 0)
})

test('returns every verified match instead of unrelated top-three links', async () => {
  const quota = new MemoryQuota()
  const jobs = Array.from({ length: 5 }, (_, index) => ({ id: `job-${index}`, company: `Company ${index}`, role: 'Remote Designer', applyUrl: `https://jobs.example.com/${index}` }))
  let upstreamCalls = 0
  const handlers = createAiChatHandlers<Env>({
    authenticate: async () => ({ id: 'user-1' }),
    searchJobs: async () => ({ jobs, total: 5, truncated: false }),
    quotaStore: quota,
    fetch: async () => ++upstreamCalls === 1 ? toolCallResponse({ role: 'designer', remote: true, allMatches: true }) : completedResponse('Five exact matches.'),
  })
  const response = await handlers.chat(request({ query: 'Show all remote designer jobs' }), { OPENAI_API_KEY: 'server-secret' })
  const payload = await response.json() as { sources: unknown[]; matches: { total: number; shown: number } }
  assert.equal(response.status, 200)
  assert.equal(payload.sources.length, 5)
  assert.deepEqual(payload.matches, { total: 5, shown: 5, truncated: false })
})

test('quota exhaustion returns 429 without calling retrieval or OpenAI', async () => {
  const quota = new MemoryQuota()
  quota.used = 200
  let upstreamCalls = 0
  const handlers = createAiChatHandlers<Env>({
    authenticate: async () => ({ id: 'user-1' }),
    searchJobs: async () => { throw new Error('must not run') },
    quotaStore: quota,
    fetch: async () => { upstreamCalls += 1; return completedResponse() },
    now: () => new Date('2026-08-08T12:00:00.000Z'),
  })
  const response = await handlers.chat(request({ query: 'Find a role' }), { OPENAI_API_KEY: 'server-secret' })
  assert.equal(response.status, 429)
  assert.equal(upstreamCalls, 0)
  const payload = await response.json() as any
  assert.equal(payload.usage.used, 200)
  assert.equal(payload.usage.remaining, 0)
  assert.equal(payload.usage.resetsAt, '2026-08-09T00:00:00.000Z')
})

test('per-user burst rejection happens before reservation, retrieval, and OpenAI', async () => {
  const quota = new MemoryQuota()
  let retrievalCalls = 0
  let upstreamCalls = 0
  let limiterKey = ''
  const handlers = createAiChatHandlers<Env>({
    authenticate: async () => ({ id: 'user-1' }),
    searchJobs: async () => { retrievalCalls += 1; return { jobs: [], total: 0, truncated: false } },
    quotaStore: quota,
    fetch: async () => { upstreamCalls += 1; return completedResponse() },
  })
  const response = await handlers.chat(request({ query: 'Find a role' }), {
    OPENAI_API_KEY: 'server-secret',
    AI_RATE_LIMITER: { limit: async ({ key }) => { limiterKey = key; return { success: false } } },
  })
  assert.equal(response.status, 429)
  assert.equal(response.headers.get('retry-after'), '60')
  assert.equal(limiterKey, 'ai:user:user-1')
  assert.equal(retrievalCalls, 0)
  assert.equal(upstreamCalls, 0)
  assert.equal(quota.used, 0)
  assert.equal(quota.reservations.size, 0)
})

test('200 concurrent reservations are the hard ceiling', async () => {
  const quota = new MemoryQuota()
  const reservations = await Promise.all(Array.from({ length: 250 }, () => quota.reserve({}, 'user-1', '2026-08-08', 0)))
  assert.equal(reservations.filter(Boolean).length, 200)
  assert.equal(quota.reservations.size, 200)
})

test('usage endpoint returns the direct UI contract', async () => {
  const quota = new MemoryQuota()
  quota.used = 17
  const handlers = createAiChatHandlers<Env>({
    authenticate: async () => ({ id: 'user-1' }),
    searchJobs: async () => ({ jobs: [], total: 0, truncated: false }),
    quotaStore: quota,
    now: () => new Date('2026-08-08T12:00:00.000Z'),
  })
  const response = await handlers.usage(new Request('https://example.com/api/ai/usage'), {})
  assert.equal(response.status, 200)
  assert.deepEqual(await response.json(), { limit: 200, used: 17, remaining: 183, resetsAt: '2026-08-09T00:00:00.000Z' })
})
