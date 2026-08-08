# Findmeajob

Findmeajob is a public jobs catalog with server-side semantic search and an authenticated job-search assistant. The application uses TanStack Start and React in the browser, Hono at the API boundary, and Cloudflare Workers, D1, R2, and Vectorize in production.

Production site: [findmeajob.dev](https://findmeajob.dev)

## Features

- Search and filter normalized job records by role, country, and other catalog fields.
- Semantic search powered by Voyage embeddings and Cloudflare Vectorize.
- Google-only sign-in through Better Auth.
- Ask AI job search powered by a server-side GPT-5.6 Luna integration.
- Validated application links and company logos served through the Worker.
- Layered rate limits, edge caching, security headers, crawler controls, and a 200-successful-answer daily AI allowance.

## Architecture

- `src/` contains the TanStack Start application and shared browser types.
- `server/` contains the Hono API, authentication, AI integration, rate limiting, and tests.
- `src/server.ts` routes document requests to TanStack Start and `/api/*` requests to Hono.
- D1 stores the job catalog and Findmeajob user/authentication data.
- R2 stores company logos; the production logo set is not bundled into the frontend.
- Vectorize stores job embeddings. The embedding model must match the model used for ingestion.

## Requirements

- Node.js 22+
- pnpm 10.15.1 (use Corepack)
- A Cloudflare account for production D1, R2, Vectorize, and Workers resources
- Google OAuth credentials for sign-in
- Voyage and OpenAI server-side API keys for semantic search and Ask AI

## Local setup

```sh
corepack enable
pnpm install
Copy-Item .dev.vars.example .dev.vars  # PowerShell
pnpm run db:migrate:local
pnpm run dev
```

The development app runs at `http://localhost:4173`. The optional Node-only API server runs at `http://localhost:8787`:

```sh
pnpm run server
```

Do not expose the Node server to the Internet. Review `wrangler.jsonc` before local development: the configured D1 bindings may be remote, while commands with `--local` use local D1 state. Never put credentials in tracked files.

## Commands

```sh
pnpm run dev                 # Vite/TanStack Start development server
pnpm run server              # Optional local Hono server
pnpm test                    # Server tests
pnpm run typecheck           # Client and server TypeScript checks
pnpm run build               # Production build
pnpm run security:audit      # Production dependency audit
pnpm run db:migrate:local    # Apply migrations to local D1
pnpm run db:migrate:remote   # Apply migrations to remote D1
pnpm run deploy:cloudflare   # Build and deploy the Worker
```

## Environment variables

Copy `.dev.vars.example` for local development. Production values must be stored as Cloudflare Worker secrets, never as plaintext Wrangler variables or repository files.

| Variable | Purpose |
| --- | --- |
| `VOYAGE_API_KEY` | Server-only semantic-search embeddings |
| `VOYAGE_EMBED_MODEL` | Embedding model used for queries and ingestion |
| `OPENAI_API_KEY` | Server-only Ask AI requests |
| `OPENAI_AI_MODEL` | Model used by Ask AI |
| `BETTER_AUTH_SECRET` | Session/signing secret; use at least 32 random characters |
| `BETTER_AUTH_URL` | Exact application origin used by Better Auth |
| `GOOGLE_CLIENT_ID` | Google OAuth client ID |
| `GOOGLE_CLIENT_SECRET` | Google OAuth client secret |
| `VITE_TURNSTILE_SITE_KEY` | Optional public Turnstile site key |

Browser-supplied provider keys are not accepted. The Worker owns all job-catalog, logo, embedding, authentication, quota, and AI credentials.

## Google sign-in

Create a Google Web OAuth client with these redirect URI patterns:

- Local: `http://localhost:4173/api/auth/callback/google`
- Production: `https://findmeajob.dev/api/auth/callback/google`

Set the production `BETTER_AUTH_URL` secret to `https://findmeajob.dev`. In Google Cloud, add `https://findmeajob.dev` as an authorized JavaScript origin and use the production callback above as the authorized redirect URI. Apply all D1 migrations before testing sign-in, Ask AI, or a fresh catalog deployment.

## API surface

Public routes:

- `GET /api/jobs` - paginated job summaries and filters
- `GET /api/jobs/:id` - full job details and a validated application URL
- `POST /api/jobs/search` - bounded, rate-limited semantic search
- `GET /api/logos/:slug` - cached company logo response
- `GET /api/health` - rate-limited liveness response

Authenticated routes:

- `GET|POST /api/auth/*` - Better Auth with Google OAuth
- `POST /api/ai/chat` - job-search assistant
- `GET /api/ai/usage` - current daily successful-answer allowance

Ask AI accepts job-search questions and returns verified catalog matches with application links. Each account receives 200 successful answers per UTC day. Retrieval, provider, timeout, and validation failures release the reservation and do not consume the daily allowance.

## Cloudflare bindings

The Worker expects bindings named `JOBSTORE` (or `DB`), `AUTH_DB`, `VECTORIZE` (or `JOB_INDEX`), and `COMPANY_LOGOS`, plus the configured rate-limit bindings. Resource IDs and names in `wrangler.jsonc` belong to the deployment account; replace them when deploying your own instance. Cloudflare management tokens are for operator-controlled ingestion only and must never be included in the Worker bundle.

For semantic search, re-embed all documents if the Vectorize index was created with a different embedding model. Matching vector dimensions alone is not sufficient.

The checked-in IBM Plex Mono font is distributed under the SIL Open Font License in `public/assets/fonts/LICENSE.txt`. Commercial Maison and Reckless font files are intentionally not included; browsers use the declared system fallbacks. The hero and footer artwork are original repository assets.

## Security notes

The Worker applies method and input validation, same-origin API access by default, route-specific rate limits, edge caching, ETags, upstream timeouts, security headers, and crawler controls. These measures reduce abuse and cost; publicly visible job data can still be copied.

For production, also verify Cloudflare WAF, Bot Fight Mode, custom-domain proxying, rate-limit rules, billing alerts, D1 recovery, and log redaction in the Cloudflare dashboard.

## License

This project is released under the [MIT License](LICENSE).
