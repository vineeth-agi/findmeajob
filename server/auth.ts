import { betterAuth, type BetterAuthOptions } from 'better-auth'

export const AUTH_BASE_PATH = '/api/auth'

const SESSION_EXPIRES_IN_SECONDS = 60 * 60 * 24 * 7
const SESSION_UPDATE_AGE_SECONDS = 60 * 60 * 24

type BetterAuthDatabase = NonNullable<BetterAuthOptions['database']>

/** Bindings required by the Better Auth request-scoped factory. */
export type AuthBindings = {
  AUTH_DB: unknown
  BETTER_AUTH_SECRET: string
  BETTER_AUTH_URL: string
  BETTER_AUTH_TRUSTED_ORIGINS?: string
  GOOGLE_CLIENT_ID: string
  GOOGLE_CLIENT_SECRET: string
}

const required = (value: string | undefined, name: string) => {
  const normalized = value?.trim()
  if (!normalized) throw new Error(`${name} is required`)
  return normalized
}

const normalizeBaseUrl = (value: string) => {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw new Error('BETTER_AUTH_URL must be an absolute URL')
  }

  if (url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
    throw new Error('BETTER_AUTH_URL must contain only an origin')
  }

  const local = url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname === '[::1]'
  if (url.protocol !== 'https:' && !(local && url.protocol === 'http:')) {
    throw new Error('BETTER_AUTH_URL must use HTTPS outside local development')
  }

  return url.origin
}

const trustedOrigins = (baseURL: string, configured: string | undefined) => {
  const origins = new Set([new URL(baseURL).origin])
  for (const candidate of configured?.split(',') ?? []) {
    const value = candidate.trim()
    if (!value) continue
    let url: URL
    try {
      url = new URL(value)
    } catch {
      throw new Error('BETTER_AUTH_TRUSTED_ORIGINS must be a comma-separated list of absolute origins')
    }
    if (url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
      throw new Error('BETTER_AUTH_TRUSTED_ORIGINS entries must contain origins only')
    }
    origins.add(url.origin)
  }
  return [...origins]
}

/**
 * Create Better Auth inside the Worker request where D1 bindings are available.
 * D1 persists users, sessions, verification records, and auth rate limits.
 */
export const createAuth = (env: AuthBindings) => {
  const secret = required(env.BETTER_AUTH_SECRET, 'BETTER_AUTH_SECRET')
  if (secret.length < 32) throw new Error('BETTER_AUTH_SECRET must be at least 32 characters')

  const baseURL = normalizeBaseUrl(required(env.BETTER_AUTH_URL, 'BETTER_AUTH_URL'))
  const googleClientId = required(env.GOOGLE_CLIENT_ID, 'GOOGLE_CLIENT_ID')
  const googleClientSecret = required(env.GOOGLE_CLIENT_SECRET, 'GOOGLE_CLIENT_SECRET')

  return betterAuth({
    appName: 'Findmeajob',
    baseURL,
    basePath: AUTH_BASE_PATH,
    secret,
    trustedOrigins: trustedOrigins(baseURL, env.BETTER_AUTH_TRUSTED_ORIGINS),
    database: env.AUTH_DB as BetterAuthDatabase,
    user: {
      modelName: 'auth_user',
    },
    session: {
      modelName: 'auth_session',
      expiresIn: SESSION_EXPIRES_IN_SECONDS,
      updateAge: SESSION_UPDATE_AGE_SECONDS,
    },
    account: {
      modelName: 'auth_account',
      encryptOAuthTokens: true,
      accountLinking: {
        enabled: true,
        trustedProviders: ['google'],
        allowDifferentEmails: false,
      },
    },
    verification: {
      modelName: 'auth_verification',
    },
    socialProviders: {
      google: {
        clientId: googleClientId,
        clientSecret: googleClientSecret,
        prompt: 'select_account',
      },
    },
    rateLimit: {
      enabled: true,
      storage: 'database',
      modelName: 'auth_rate_limit',
      window: 60,
      max: 60,
      customRules: {
        '/sign-in/social': {
          window: 60,
          max: 10,
        },
        '/callback/google': {
          window: 60,
          max: 20,
        },
      },
    },
    advanced: {
      ipAddress: {
        ipAddressHeaders: ['cf-connecting-ip'],
      },
      defaultCookieAttributes: {
        httpOnly: true,
        sameSite: 'lax',
        secure: baseURL.startsWith('https://'),
        path: '/',
      },
    },
  })
}

/** Mount this on GET/POST `/api/auth/*` from the Hono app. */
export const handleAuthRequest = (request: Request, env: AuthBindings) => createAuth(env).handler(request)

/** Resolve the signed-in user for protected API handlers such as Ask AI. */
export const getAuthSession = (request: Request, env: AuthBindings) =>
  createAuth(env).api.getSession({ headers: request.headers })

export type Auth = ReturnType<typeof createAuth>
export type AuthSession = NonNullable<Awaited<ReturnType<typeof getAuthSession>>>
