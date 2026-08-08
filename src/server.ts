import handler from '@tanstack/react-start/server-entry'
import app, { countD1SitemapJobs, readD1SitemapJobs, visitorCountryCode, type Bindings } from '../server/app'
import { enforcePublicJobRateLimit, knownAiCrawler, withVisitorSessionCookie } from '../server/anti-scraping'
import { jobPath } from './shared/jobs'
import { SITE_ORIGIN } from './shared/seo'

type WorkerHandler = {
  fetch: (request: Request, env?: unknown, ctx?: unknown) => Promise<Response>
}
type WorkerContext = { waitUntil?: (promise: Promise<unknown>) => void }
type EdgeCache = { match: (request: Request) => Promise<Response | undefined>; put: (request: Request, response: Response) => Promise<void> }
const API_CACHE_VERSION = '6'
const SITEMAP_PAGE_SIZE = 5_000

const startHandler = handler as unknown as WorkerHandler
const apiHandler = app as unknown as WorkerHandler
const cacheableApiRequest = (request: Request) => {
  if (request.method !== 'GET' || request.headers.has('Authorization')) return null
  const url = new URL(request.url)
  const detail = /^\/api\/jobs\/[A-Za-z0-9_-]+$/.test(url.pathname)
  if (url.pathname !== '/api/jobs' && !detail && !url.pathname.startsWith('/api/logos/')) return null
  if (url.pathname === '/api/jobs') {
    const allowed = new Set(['country', 'search', 'role', 'page', 'pageSize'])
    if (Array.from(url.searchParams.keys()).some((key) => !allowed.has(key) || url.searchParams.getAll(key).length > 1)) return null
    const normalized = new URL(url.origin + url.pathname)
    Array.from(url.searchParams.entries()).sort(([a, av], [b, bv]) => a.localeCompare(b) || av.localeCompare(bv)).forEach(([key, value]) => normalized.searchParams.append(key, value))
    url.search = normalized.search
    if (!url.searchParams.has('country')) {
      const countryCode = visitorCountryCode(request)
      if (countryCode) url.searchParams.set('__geo', countryCode)
    }
  } else {
    url.search = ''
  }
  url.searchParams.set('__cache', API_CACHE_VERSION)
  return new Request(url.toString(), { method: 'GET', headers: { Accept: request.headers.get('Accept') || 'application/json' } })
}
const edgeCache = () => (globalThis as unknown as { caches?: { default?: EdgeCache } }).caches?.default
const secureResponse = (response: Response, request: Request, api: boolean) => {
  const headers = new Headers(response.headers)
  headers.set('X-Content-Type-Options', 'nosniff')
  headers.set('X-Frame-Options', 'DENY')
  headers.set('Referrer-Policy', 'strict-origin-when-cross-origin')
  headers.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=(), usb=()')
  headers.set('Cross-Origin-Opener-Policy', 'same-origin')
  if (new URL(request.url).protocol === 'https:') headers.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains')
  if (api) {
    if (!headers.has('X-Request-ID')) headers.set('X-Request-ID', request.headers.get('X-Request-ID')?.slice(0, 128) || crypto.randomUUID())
    headers.set('X-Robots-Tag', 'noindex, nofollow, noarchive')
    headers.set('Cross-Origin-Resource-Policy', 'same-origin')
    headers.set('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'; base-uri 'none'")
  } else {
    headers.set('Content-Security-Policy', "base-uri 'none'; object-src 'none'; frame-ancestors 'none'; form-action 'self'")
    headers.set('Content-Security-Policy-Report-Only', "default-src 'self'; script-src 'self' 'unsafe-inline' https://challenges.cloudflare.com; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-src https://challenges.cloudflare.com; font-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'")
  }
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers })
}

const xmlEscape = (value: string) => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;')

const seoResponse = (body: string, contentType: string, request: Request) => secureResponse(new Response(body, {
  headers: { 'Content-Type': contentType, 'Cache-Control': 'public, max-age=300, stale-while-revalidate=3600' },
}), request, false)

const within = async <T,>(promise: Promise<T>, milliseconds: number, fallback: T) => Promise.race([
  promise,
  new Promise<T>((resolve) => setTimeout(() => resolve(fallback), milliseconds)),
])

const sitemapIndexResponse = async (request: Request, env: unknown) => {
  const origin = SITE_ORIGIN
  const total = await within(countD1SitemapJobs(env as Bindings), 4_000, null)
  if (total == null) return seoResponse('<?xml version="1.0" encoding="UTF-8"?><sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"></sitemapindex>', 'application/xml; charset=utf-8', request)
  const pages = Math.max(1, Math.ceil(total / SITEMAP_PAGE_SIZE))
  const entries = Array.from({ length: pages }, (_, index) => `<sitemap><loc>${xmlEscape(`${origin}/sitemaps/jobs-${index + 1}.xml`)}</loc></sitemap>`)
  return seoResponse(`<?xml version="1.0" encoding="UTF-8"?><sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${entries.join('')}</sitemapindex>`, 'application/xml; charset=utf-8', request)
}

const sitemapPageResponse = async (request: Request, env: unknown, page: number) => {
  const origin = SITE_ORIGIN
  const jobs = await within(readD1SitemapJobs(env as Bindings, page, SITEMAP_PAGE_SIZE), 4_000, null)
  if (jobs == null) return secureResponse(new Response('Sitemap is temporarily unavailable.', { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' } }), request, false)
  if (page > 1 && jobs.length === 0) return secureResponse(new Response('Not found', { status: 404, headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' } }), request, false)
  const entries = [
    ...(page === 1 ? [`<url><loc>${xmlEscape(`${origin}/`)}</loc></url>`] : []),
    ...jobs.map((job) => `<url><loc>${xmlEscape(`${origin}${jobPath(job)}`)}</loc>${job.dateModified ? `<lastmod>${xmlEscape(job.dateModified)}</lastmod>` : ''}</url>`),
  ]
  return seoResponse(`<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${entries.join('')}</urlset>`, 'application/xml; charset=utf-8', request)
}

const securityEvent = (event: string, request: Request, detail?: string | null) => console.warn(JSON.stringify({
  event,
  detail: detail || undefined,
  path: new URL(request.url).pathname,
  country: request.headers.get('CF-IPCountry') || undefined,
  ray: request.headers.get('CF-Ray') || undefined,
}))

const blockedCrawlerResponse = (request: Request, crawler: string) => {
  securityEvent('ai_crawler_blocked', request, crawler)
  return secureResponse(new Response('Automated AI crawling is not permitted.', {
    status: 403,
    headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex, nofollow, noarchive' },
  }), request, false)
}

const rateLimitedResponse = (request: Request, scope: string | null) => {
  securityEvent('public_job_rate_limited', request, scope)
  return secureResponse(new Response(JSON.stringify({ error: 'Too many job requests. Please retry shortly.' }), {
    status: 429,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'Retry-After': '60' },
  }), request, true)
}

/**
 * TanStack Start owns document requests while Hono owns the public API.
 * Keeping this boundary explicit preserves every existing /api endpoint and
 * lets the same Hono app run locally through @hono/node-server.
 */
export default {
  async fetch(request: Request, env: unknown, ctx: WorkerContext) {
    const pathname = new URL(request.url).pathname
    if (request.method === 'GET' && pathname === '/robots.txt') {
      return seoResponse(`# Findmeajob content-use policy\nUser-agent: *\nContent-signal: search=yes, ai-input=no, ai-train=no\nAllow: /\nDisallow: /api/\n\nUser-agent: GPTBot\nDisallow: /\n\nUser-agent: ClaudeBot\nDisallow: /\n\nUser-agent: anthropic-ai\nDisallow: /\n\nUser-agent: CCBot\nDisallow: /\n\nUser-agent: Bytespider\nDisallow: /\n\nUser-agent: Google-Extended\nDisallow: /\n\nUser-agent: Amazonbot\nDisallow: /\n\nUser-agent: Applebot-Extended\nDisallow: /\n\nUser-agent: meta-externalagent\nDisallow: /\n\nSitemap: ${SITE_ORIGIN}/sitemap.xml\n`, 'text/plain; charset=utf-8', request)
    }
    const crawler = knownAiCrawler(request)
    if (crawler) return blockedCrawlerResponse(request, crawler)
    if (request.method === 'GET' && pathname === '/sitemap.xml') return sitemapIndexResponse(request, env)
    const sitemapPage = request.method === 'GET' ? pathname.match(/^\/sitemaps\/jobs-([1-9]\d*)\.xml$/) : null
    if (sitemapPage) return sitemapPageResponse(request, env, Number(sitemapPage[1]))
    if (pathname === '/api' || pathname.startsWith('/api/')) {
      const rateLimit = await enforcePublicJobRateLimit(request, env as Bindings)
      if (!rateLimit.allowed) return rateLimitedResponse(request, rateLimit.scope)
      const cacheKey = cacheableApiRequest(request)
      const cache = cacheKey ? edgeCache() : undefined
      const cached = cache && cacheKey ? await cache.match(cacheKey) : undefined
      if (cached) return secureResponse(cached, request, true)
      const response = secureResponse(await apiHandler.fetch(request, env, ctx), request, true)
      if (cache && cacheKey && response.ok && !response.headers.has('Set-Cookie') && response.headers.get('Cache-Control')?.includes('public')) {
        const cacheHeaders = new Headers(response.headers)
        cacheHeaders.delete('X-Request-ID')
        const cacheResponse = new Response(response.clone().body, { status: response.status, statusText: response.statusText, headers: cacheHeaders })
        const write = cache.put(cacheKey, cacheResponse).catch((error) => console.warn('Edge cache write failed', error instanceof Error ? error.message : 'cache failure'))
        if (ctx?.waitUntil) ctx.waitUntil(write); else await write
      }
      return response
    }
    return withVisitorSessionCookie(request, secureResponse(await startHandler.fetch(request, env, ctx), request, false))
  },
}
