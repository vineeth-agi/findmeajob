import { createServerFn } from '@tanstack/react-start'
import { getRequest } from '@tanstack/react-start/server'
import { env } from 'cloudflare:workers'
import app, { visitorCountryCode, type Bindings } from '../../server/app'
import type { Job, JobPageData } from '../shared/jobs'

type JobsPayload = Partial<JobPageData> & { data?: Job[]; jobs?: Job[] }

const requestJson = async <T>(path: string): Promise<T | null> => {
  const request = getRequest()
  const headers = new Headers({ Accept: 'application/json' })
  const countryCode = visitorCountryCode(request)
  if (countryCode) headers.set('X-Findmeajob-Visitor-Country', countryCode)
  const apiRequest = new Request(new URL(path, request.url), {
    headers,
  })
  // A Worker cannot reliably fetch its own public URL while it is rendering a
  // document. Run the same Hono API in-process with the current bindings so
  // loaders retain API validation, rate limiting, and response sanitization.
  const response = await app.request(apiRequest, undefined, env as unknown as Bindings)
  if (!response.ok) return null
  return response.json() as Promise<T>
}

const emptyPage: JobPageData = {
  jobs: [],
  total: 0,
  page: 1,
  pageSize: 40,
  totalPages: 1,
  countries: [],
  roles: [],
  selectedCountry: '',
  countryAutoSelected: false,
}

export const getInitialJobs = createServerFn({ method: 'GET' }).handler(async (): Promise<JobPageData> => {
  const payload = await requestJson<JobsPayload>('/api/jobs?page=1&pageSize=40')
  if (!payload) return emptyPage
  return {
    jobs: payload.jobs ?? payload.data ?? [],
    total: payload.total ?? 0,
    page: payload.page ?? 1,
    pageSize: payload.pageSize ?? 40,
    totalPages: payload.totalPages ?? 1,
    countries: payload.countries ?? [],
    roles: payload.roles ?? [],
    selectedCountry: payload.selectedCountry ?? '',
    countryAutoSelected: payload.countryAutoSelected ?? false,
  }
})

export const getJobById = createServerFn({ method: 'GET' })
  .validator((data: { id: string }) => data)
  .handler(async ({ data }): Promise<Job | null> => {
    const id = data.id.trim()
    if (!id || id.length > 128) return null
    const ids = /^admin-/i.test(id) ? [id] : [id, `admin-${id}`]
    for (const candidate of ids) {
      const payload = await requestJson<{ data?: Job }>(`/api/jobs/${encodeURIComponent(candidate)}`)
      if (payload?.data) return payload.data
    }
    return null
  })
