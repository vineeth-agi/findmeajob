/** Canonical job shape shared by the TanStack client and Hono API. */
export interface Job {
  id: string
  company: string
  role: string
  posted: string
  locations: string[]
  compensation: string[]
  applyUrl: string
  logoUrl: string
  description: string
  companyAbout: string
  responsibilities: string[]
  requirements: string[]
  benefits: string[]
  extras: string[]
  /** ISO dates retained for structured data and freshness signals. */
  datePosted?: string
  dateModified?: string
  employmentType?: string
  workMode?: string
}

export interface JobFilters { country?: string; search?: string; role?: string }

export interface JobPageData {
  jobs: Job[]
  total: number
  page: number
  pageSize: number
  totalPages: number
  countries: string[]
  roles: string[]
  selectedCountry?: string
  countryAutoSelected?: boolean
}

export const slugifyJobPart = (value: string) => value
  .trim()
  .toLowerCase()
  .replace(/&/g, 'and')
  .replace(/[^a-z0-9]+/g, '-')
  .replace(/^-|-$/g, '')

/** Internal imports may use an `admin-` namespace; keep that implementation detail out of public URLs. */
export const publicJobId = (id: string) => id.replace(/^admin-/i, '')

/** Stable, crawlable URL for an individual job. The id prevents slug collisions. */
export const jobPath = (job: Pick<Job, 'id' | 'company' | 'role'>) =>
  `/jobs/${encodeURIComponent(publicJobId(job.id))}/${slugifyJobPart(`${job.company}-${job.role}`)}`

/** Apply the catalog filters to records returned by the database. */
export const filterJobs = (source: readonly Job[], { country, search, role }: JobFilters = {}) => {
  const c = country?.trim().toLowerCase()
  const s = search?.trim().toLowerCase()
  const r = role?.trim().toLowerCase()
  return source.filter((job) =>
    (!c || job.locations.some((location) => location.trim().toLowerCase() === c)) &&
    (!r || job.role.toLowerCase().includes(r)) &&
    (!s || `${job.company} ${job.role} ${job.locations.join(' ')} ${job.compensation.join(' ')}`.toLowerCase().includes(s)),
  )
}
