type RateLimitLike = { limit: (options: { key: string }) => Promise<{ success: boolean }> }

export interface AntiScrapingBindings {
  PUBLIC_JOB_RATE_LIMITER?: RateLimitLike
  JOB_LIST_RATE_LIMITER?: RateLimitLike
  JOB_DETAIL_RATE_LIMITER?: RateLimitLike
}

export type PublicJobScope = 'jobs-list' | 'job-detail'

const AI_CRAWLERS: ReadonlyArray<readonly [string, RegExp]> = [
  ['GPTBot', /(?:^|[\s;/])GPTBot(?:[\s;/]|$)/i],
  ['ClaudeBot', /(?:^|[\s;/])ClaudeBot(?:[\s;/]|$)/i],
  ['anthropic-ai', /(?:^|[\s;/])anthropic-ai(?:[\s;/]|$)/i],
  ['CCBot', /(?:^|[\s;/])CCBot(?:[\s;/]|$)/i],
  ['Bytespider', /(?:^|[\s;/])Bytespider(?:[\s;/]|$)/i],
  ['Google-Extended', /(?:^|[\s;/])Google-Extended(?:[\s;/]|$)/i],
  ['Amazonbot', /(?:^|[\s;/])Amazonbot(?:[\s;/]|$)/i],
  ['Applebot-Extended', /(?:^|[\s;/])Applebot-Extended(?:[\s;/]|$)/i],
  ['meta-externalagent', /(?:^|[\s;/])meta-externalagent(?:[\s;/]|$)/i],
]

const cookieValue = (header: string, name: string) => header
  .split(';')
  .map((part) => part.trim())
  .find((part) => part.startsWith(`${name}=`))
  ?.slice(name.length + 1) || ''

const validSession = (request: Request) => cookieValue(request.headers.get('Cookie') || '', 'fmj_session')
  .replace(/[^A-Za-z0-9_-]/g, '')
  .slice(0, 64)

export const knownAiCrawler = (request: Request) => {
  const userAgent = request.headers.get('User-Agent') || ''
  return AI_CRAWLERS.find(([, pattern]) => pattern.test(userAgent))?.[0] ?? null
}

export const publicJobScope = (request: Request): PublicJobScope | null => {
  if (request.method !== 'GET') return null
  const pathname = new URL(request.url).pathname
  if (pathname === '/api/jobs') return 'jobs-list'
  if (/^\/api\/jobs\/[A-Za-z0-9_-]+$/.test(pathname)) return 'job-detail'
  return null
}

const callLimiter = async (limiter: RateLimitLike | undefined, key: string) => {
  if (!limiter) return true
  return (await limiter.limit({ key })).success
}

/**
 * Runs before the edge cache so cached catalog responses cannot bypass abuse
 * controls. The aggregate counter is IP based; the route counter also uses the
 * anonymous browser session to reduce collisions for normal shared networks.
 */
export const enforcePublicJobRateLimit = async (request: Request, env: AntiScrapingBindings) => {
  const scope = publicJobScope(request)
  if (!scope) return { allowed: true, scope: null as PublicJobScope | null }

  const ip = (request.headers.get('CF-Connecting-IP') || 'unknown').trim().slice(0, 128)
  const session = validSession(request) || 'anonymous'
  const routeLimiter = scope === 'jobs-list' ? env.JOB_LIST_RATE_LIMITER : env.JOB_DETAIL_RATE_LIMITER

  try {
    const [aggregateAllowed, routeAllowed] = await Promise.all([
      callLimiter(env.PUBLIC_JOB_RATE_LIMITER, `public-jobs:ip:${ip}`),
      callLimiter(routeLimiter, `${scope}:ip:${ip}:session:${session}`),
    ])
    return { allowed: aggregateAllowed && routeAllowed, scope }
  } catch (error) {
    // A limiter outage should not take down public job browsing. Existing Hono
    // limits remain a second layer for uncached responses.
    console.warn('Anti-scraping rate limiter unavailable', error instanceof Error ? error.message : 'rate limit failure')
    return { allowed: true, scope }
  }
}

export const withVisitorSessionCookie = (request: Request, response: Response) => {
  if (validSession(request)) return response
  const headers = new Headers(response.headers)
  const secure = new URL(request.url).protocol === 'https:' ? '; Secure' : ''
  const session = crypto.randomUUID().replace(/-/g, '')
  headers.append('Set-Cookie', `fmj_session=${session}; Path=/; Max-Age=604800; HttpOnly${secure}; SameSite=Lax`)
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers })
}
