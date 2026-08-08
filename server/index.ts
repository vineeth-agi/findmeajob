import { serve } from '@hono/node-server'
import { readFileSync } from 'node:fs'
import app from './app.js'

// The Node adapter remains available for local API-only development and tests.
// Production requests are handled by the Cloudflare Worker entry at src/server.ts.
try {
  const source = readFileSync(new URL('../.dev.vars', import.meta.url), 'utf8')
  for (const line of source.split(/\r?\n/)) {
    const match = line.match(/^\s*([^#=]+)=(.*)$/)
    if (match) {
      const [, key, value] = match
      if (key && !process.env[key.trim()]) process.env[key.trim()] = value.trim()
    }
  }
} catch {
  // Local credentials are optional; without them the API reports the jobstore as unavailable.
}

const port = Number(process.env.PORT || 8787)
if (process.env.NODE_ENV !== 'test') {
  serve({ fetch: app.fetch, port })
  console.log(`Findmeajob API listening on http://localhost:${port}`)
}
