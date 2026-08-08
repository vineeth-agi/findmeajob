import assert from 'node:assert/strict'
import test from 'node:test'
import {
  enforcePublicJobRateLimit,
  knownAiCrawler,
  publicJobScope,
  withVisitorSessionCookie,
  type AntiScrapingBindings,
} from './anti-scraping.js'

test('known AI training crawlers are identified without blocking search crawlers', () => {
  assert.equal(knownAiCrawler(new Request('https://example.com/jobs/1/role', { headers: { 'User-Agent': 'Mozilla/5.0 (compatible; GPTBot/1.2)' } })), 'GPTBot')
  assert.equal(knownAiCrawler(new Request('https://example.com/jobs/1/role', { headers: { 'User-Agent': 'Googlebot/2.1 (+http://www.google.com/bot.html)' } })), null)
  assert.equal(knownAiCrawler(new Request('https://example.com/jobs/1/role', { headers: { 'User-Agent': 'Mozilla/5.0' } })), null)
})

test('only public catalog reads use the edge anti-scraping limiter', () => {
  assert.equal(publicJobScope(new Request('https://example.com/api/jobs?page=1')), 'jobs-list')
  assert.equal(publicJobScope(new Request('https://example.com/api/jobs/job-123')), 'job-detail')
  assert.equal(publicJobScope(new Request('https://example.com/api/jobs/search', { method: 'POST' })), null)
  assert.equal(publicJobScope(new Request('https://example.com/jobs/job-123/role')), null)
})

test('aggregate and route-specific limits run before a public job response', async () => {
  const keys: string[] = []
  const aggregate = { limit: async ({ key }: { key: string }) => { keys.push(key); return { success: true } } }
  const list = { limit: async ({ key }: { key: string }) => { keys.push(key); return { success: false } } }
  const env: AntiScrapingBindings = { PUBLIC_JOB_RATE_LIMITER: aggregate, JOB_LIST_RATE_LIMITER: list }
  const request = new Request('https://example.com/api/jobs?page=1', {
    headers: {
      'CF-Connecting-IP': '203.0.113.8',
      'X-Forwarded-For': '198.51.100.99',
      Cookie: 'fmj_session=browser_session_123',
    },
  })
  const result = await enforcePublicJobRateLimit(request, env)
  assert.equal(result.allowed, false)
  assert.equal(result.scope, 'jobs-list')
  assert.deepEqual(keys, [
    'public-jobs:ip:203.0.113.8',
    'jobs-list:ip:203.0.113.8:session:browser_session_123',
  ])
})

test('a visitor session cookie is issued once for document browsing', async () => {
  const first = withVisitorSessionCookie(new Request('https://example.com/'), new Response('ok'))
  const cookie = first.headers.get('set-cookie') || ''
  assert.match(cookie, /^fmj_session=[A-Za-z0-9_-]+;/)
  assert.match(cookie, /HttpOnly/)
  assert.match(cookie, /Secure/)
  assert.match(cookie, /SameSite=Lax/)

  const session = cookie.match(/^fmj_session=([^;]+)/)?.[1] || ''
  const existing = withVisitorSessionCookie(new Request('https://example.com/', { headers: { Cookie: `fmj_session=${session}` } }), new Response('ok'))
  assert.equal(existing.headers.get('set-cookie'), null)
})
