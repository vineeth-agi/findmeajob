import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { MouseEvent as ReactMouseEvent, RefObject } from 'react'
import { jobPath, publicJobId, type Job, type JobPageData } from './shared/jobs'
import { AskAi } from './ai-chat'
import { Dock, type DockTheme } from './dock'
import { FooterScene } from './footer-scene'

const jobTags = (job: Job) => [...job.locations.slice(0, 1), ...job.compensation.slice(0, 1)].filter((tag) => tag.trim() && !/^\[object object\]$/i.test(tag.trim()))

function useDebouncedValue<T>(value: T, delay: number) {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(value), delay)
    return () => window.clearTimeout(timer)
  }, [value, delay])
  return debounced
}

function resolveInitialDockTheme(): DockTheme {
  if (typeof window === 'undefined') return 'dark'
  const storedTheme = window.localStorage.getItem('de-theme')
  if (storedTheme === 'light' || storedTheme === 'dark') return storedTheme
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

function useDockTheme() {
  // Keep the first render identical on the server and browser, then restore a
  // visitor's saved preference after hydration to avoid an SSR mismatch.
  const [theme, setThemeState] = useState<DockTheme>('dark')
  useEffect(() => {
    const initialTheme = resolveInitialDockTheme()
    setThemeState(initialTheme)
    document.documentElement.dataset.theme = initialTheme
    window.localStorage.setItem('de-theme', initialTheme)
  }, [])
  const setTheme = useCallback((nextTheme: DockTheme) => {
    setThemeState(nextTheme)
    document.documentElement.dataset.theme = nextTheme
    window.localStorage.setItem('de-theme', nextTheme)
  }, [])
  return [theme, setTheme] as const
}

const HERO_QUOTES = [
  { text: "You don't have to be great to start, but you have to start to be great.", author: 'Zig Ziglar' },
  { text: "If you haven't found it yet, keep looking. Don't settle.", author: 'Steve Jobs' },
  { text: 'You have to give yourself a lot of chances to get lucky.', author: 'Sam Altman' },
  { text: "When something is important enough, you do it even if the odds are not in your favor.", author: 'Elon Musk' },
  { text: "There was never a moment where I considered my current job as a stepping stone to another position.", author: 'Satya Nadella' },
  { text: 'The sidelines are not where you want to live your life. The world needs you in the arena.', author: 'Tim Cook' },
  { text: "If you never want to be criticized, for goodness' sake don't do anything new.", author: 'Jeff Bezos' },
] as const

function Hero() {
  const [quoteIndex, setQuoteIndex] = useState(0)
  useEffect(() => {
    const timer = window.setInterval(() => setQuoteIndex((index) => (index + 1) % HERO_QUOTES.length), 10000)
    return () => window.clearInterval(timer)
  }, [])
  const quote = HERO_QUOTES[quoteIndex]
  return <header>
    <div className="mast"><a className="wordmark" href="#top" aria-label="Findmeajob home">Findme<br/>ajob</a><a className="submit" href="https://github.com/vineeth-agi/findmeajob" target="_blank" rel="noopener noreferrer">Open source ↗</a></div>
    <div className="blueprint" aria-hidden="true"><img className="hero-user-art" src="/hero-search.svg" alt="" width="574" height="661" decoding="async" draggable="false"/><span className="hero-session">OPEN ROLES / 20000+</span><span className="count"><span className="quote-line" key={quoteIndex}>{quote.text}</span><span className="quote-author quote-line" key={`${quoteIndex}-author`}>— {quote.author}</span></span></div>
  </header>
}

function JobCard({ job, index, onOpen }: { job: Job; index: number; onOpen: (job: Job) => void }) {
  const [failed, setFailed] = useState(false)
  return <li className="job-item"><a className="job-card" data-job={index} href={jobPath(job)} aria-label={`View ${job.role} at ${job.company}`} onClick={(event) => { if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return; event.preventDefault(); onOpen(job) }}>
    <span className="logo-wrap">{failed ? <span className="fallback">{job.company[0]}</span> : <img src={job.logoUrl} alt={`${job.company} logo`} loading="lazy" draggable="false" onError={() => setFailed(true)}/>}</span>
    <span className="job-main"><span className="job-top"><span className="company">{job.company}</span><span className="age">{job.posted}</span></span><span className="job-bottom"><span className="role">{job.role}</span><span className="tags">{jobTags(job).map((tag) => <span className="tag" key={tag}>{tag}</span>)}</span></span></span><span className="arrow" aria-hidden="true">↗</span>
  </a></li>
}

function JobSkeleton() {
  return <li className="job-item skeleton-item" aria-hidden="true"><div className="job-card skeleton-card">
    <span className="skeleton-logo" aria-hidden="true" />
    <span className="job-main" aria-hidden="true">
      <span className="job-top"><span className="skeleton-line skeleton-company" /><span className="skeleton-line skeleton-age" /></span>
      <span className="job-bottom"><span className="skeleton-line skeleton-role" /><span className="tags"><span className="skeleton-tag" /><span className="skeleton-tag skeleton-tag-short" /><span className="skeleton-tag skeleton-tag-tiny" /></span></span>
    </span>
  </div></li>
}

function FilterBar({ jobs, options, values, onChange, loading }: { jobs: Job[]; options: { countries: string[]; roles: string[] }; values: { search: string; country: string; role: string }; onChange: (v: { search: string; country: string; role: string }) => void; loading?: boolean }) {
  const countries = useMemo(() => options.countries.length ? options.countries : Array.from(new Map(jobs.flatMap((job) => job.locations).filter(Boolean).map((country) => [country.toLowerCase(), country])).values()).sort(), [jobs, options.countries])
  const roles = useMemo(() => options.roles.length ? options.roles : Array.from(new Map(jobs.map((job) => job.role.replace(/,.*$/, '').replace(/\s*\([^)]*\)/, '').replace(/\s+/g, ' ').trim()).filter(Boolean).map((role) => [role.toLowerCase(), role])).values()).sort(), [jobs, options.roles])
  return <div className="filter-bar" aria-label="Filter jobs" aria-busy={loading || undefined}>
    <label className="filter-search"><span className="sr-only">Search jobs</span><input value={values.search} maxLength={120} onChange={(e) => onChange({...values, search: e.target.value})} placeholder="Search roles or companies"/></label>
    <label><span className="sr-only">Country</span><select value={values.country} onChange={(e) => onChange({...values, country: e.target.value})}><option value="">All countries</option>{countries.map((country) => <option key={country} value={country}>{country}</option>)}</select></label>
    <label><span className="sr-only">Role type</span><select value={values.role} onChange={(e) => onChange({...values, role: e.target.value})}><option value="">All roles</option>{roles.map((role) => <option key={role} value={role}>{role}</option>)}</select></label>
  </div>
}

function JobsSection({ jobs, total, page, totalPages, loading, filters, options, onFiltersChange, onPageChange, onOpen, listRef }: { jobs: Job[]; total: number; page: number; totalPages: number; loading: boolean; filters: { search: string; country: string; role: string }; options: { countries: string[]; roles: string[] }; onFiltersChange: (v: { search: string; country: string; role: string }) => void; onPageChange: (page: number) => void; onOpen: (job: Job) => void; listRef: RefObject<HTMLOListElement | null> }) {
  const showSkeleton = loading && jobs.length === 0
  return <section className={`jobs${loading ? ' is-loading' : ''}`} aria-label="Tech and software job listings" id="jobs">
    <h1 className="sr-only">Findmeajob job listings</h1>
    <FilterBar jobs={jobs} options={options} values={filters} onChange={onFiltersChange} loading={loading}/>
    <div className="sr-only" role="status" aria-live="polite">{loading ? 'Updating roles…' : ''}</div>
    <ol className="job-list" ref={listRef} aria-busy={loading}>{showSkeleton ? Array.from({ length: 6 }, (_, index) => <JobSkeleton key={`skeleton-${index}`} />) : jobs.map((job, i) => <JobCard key={job.id} job={job} index={i} onOpen={onOpen}/>)}</ol>
    {showSkeleton && <div className="empty-state">Loading roles…</div>}
    {loading && jobs.length > 0 && <div className="results-status" role="status" aria-live="polite">Updating roles…</div>}
    {!loading && !jobs.length && <div className="empty-state">No roles match those filters.</div>}
    {total > 40 && <div className="pagination" aria-label="Job pages"><button className="more" disabled={page === 1 || loading} onClick={() => onPageChange(Math.max(1, page - 1))}>Previous</button><span className="page-status">Page {page} / {totalPages}</span><button className="more" disabled={page === totalPages || loading} onClick={() => onPageChange(Math.min(totalPages, page + 1))}>Next</button></div>}
  </section>
}

function Editorial() {
  return <article className="editorial">
    <section className="section intro" id="about">
      <h2>About</h2>
      <p>Findmeajob is a platform that displays Tech &amp; Software Engineering Jobs where candidates can browse and apply directly. We are independent and not affiliated with any of the companies listed.</p>
      <p>This website is inspired by <a className="plain-link" href="https://designengineer.io/" target="_blank" rel="noopener noreferrer">designengineer.io</a>. Its application UI and decorative artwork are maintained in this repository.</p>
      <p>Our motto is to help users discover official jobs directly from corporate careers pages, rather than through third-party consultancies or agencies.</p>
    </section>
    <section className="section discourse" id="support">
      <h2>Support</h2>
      <p>Donate - <a href="https://www.thankyouverymuch.co/zerolatency" target="_blank" rel="noopener">https://www.thankyouverymuch.co/zerolatency</a> ( To support this project )</p>
    </section>
    <section className="section reading" id="links">
      <h2>Links</h2>
      <ul>
        <li><a href="https://github.com/vineeth-agi/findmeajob" target="_blank" rel="noopener">Github</a></li>
        <li><a href="/terms">Terms</a></li>
        <li><a href="/privacy">Privacy</a></li>
      </ul>
    </section>
  </article>
}

function Footer() {
  return <footer className="footer">
    <a className="wordmark" href="#top">Findme<br/>ajob</a>
    <div className="strap"><a href="https://x.com/vineeth_agi" target="_blank" rel="noopener" style={{ color: 'inherit', textDecoration: 'none' }}>Built by Vineeth ↗</a></div>
    <div className="copyright"><strong>© Copyright</strong>{new Date().getFullYear()}&nbsp;&nbsp;&nbsp; Findmeajob</div>
    <FooterScene/>
  </footer>
}

function DetailModal({ job, onClose }: { job: Job | null; onClose: () => void }) {
  const closeRef = useRef<HTMLButtonElement>(null)
  useEffect(() => { if (!job) return; closeRef.current?.focus(); const previous = document.body.style.overflow; const shell = document.querySelector<HTMLElement>('.shell'); const dock = document.querySelector<HTMLElement>('.de-dock'); document.body.style.overflow = 'hidden'; if (shell) shell.inert = true; if (dock) dock.inert = true; const key = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.preventDefault(); onClose() } if (e.key === 'Tab') { const els = Array.from(document.querySelectorAll<HTMLElement>('#detailLayer button,#detailLayer a[href]')); if (!els.length) return; const first = els[0], last = els[els.length - 1]; if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus() } else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus() } } }; document.addEventListener('keydown', key, true); return () => { document.body.style.overflow = previous; if (shell) shell.inert = false; if (dock) dock.inert = false; document.removeEventListener('keydown', key, true) } }, [job, onClose])
  if (!job) return null
  return <div className="detail-layer open" id="detailLayer" aria-hidden="false" onMouseDown={(e: ReactMouseEvent) => { if (e.target === e.currentTarget) onClose() }}><article className="detail" role="dialog" aria-modal="true" aria-labelledby="detailCompany"><button className="detail-close" ref={closeRef} onClick={onClose} aria-label="Close job details">←</button><header className="detail-head"><div className="logo-wrap"><img src={job.logoUrl} alt={`${job.company} logo`} draggable="false" onError={(e) => { e.currentTarget.style.display = 'none' }}/><span className="fallback">{job.company[0]}</span></div><div><span className="age">{job.posted}</span><h1 id="detailCompany">{job.company}</h1><div className="detail-role">{job.role}</div><div className="detail-meta">{jobTags(job).map((tag) => <span className="tag" key={tag}>{tag}</span>)}</div></div></header><div className="detail-body">{job.companyAbout && <section><h2>About the company</h2><p>{job.companyAbout}</p></section>}<section><h2>About the role</h2><p>{job.description || 'Loading full role details…'}</p></section>{job.responsibilities.length > 0 && <section><h2>What you’ll do</h2><ul>{job.responsibilities.map((item) => <li key={item}>{item}</li>)}</ul></section>}{job.requirements.length > 0 && <section><h2>What we’re looking for</h2><ul>{job.requirements.map((item) => <li key={item}>{item}</li>)}</ul></section>}{job.benefits.length > 0 && <section><h2>Benefits</h2><ul>{job.benefits.map((item) => <li key={item}>{item}</li>)}</ul></section>}{job.extras.length > 0 && <section><h2>Additional details</h2><ul>{job.extras.map((item) => <li key={item}>{item}</li>)}</ul></section>}</div>{job.applyUrl && <div className="apply-dock"><a className="apply" id="applyLink" href={job.applyUrl} target="_blank" rel="noopener noreferrer"><span>Apply for this role</span><span>↗</span></a></div>}</article></div>
}

export function HomePage({ initialData }: { initialData?: JobPageData }) {
  const [theme, setTheme] = useDockTheme()
  const [compact, setCompact] = useState(false)
  const [aiOpen, setAiOpen] = useState(false)
  const [catalog, setCatalog] = useState<Job[]>(initialData?.jobs ?? [])
  const [jobTotal, setJobTotal] = useState(initialData?.total ?? 0)
  const [jobPage, setJobPage] = useState(initialData?.page ?? 1)
  const initialCountry = initialData?.selectedCountry ?? ''
  const [jobFilters, setJobFilters] = useState({ search: '', country: initialCountry, role: '' })
  const [countryResolved, setCountryResolved] = useState(Boolean(initialData))
  const [jobOptions, setJobOptions] = useState({ countries: initialData?.countries ?? [], roles: initialData?.roles ?? [] })
  const [jobsLoading, setJobsLoading] = useState(!initialData)
  const [jobsError, setJobsError] = useState('')
  const [selected, setSelected] = useState<Job | null>(null)
  const listRef = useRef<HTMLOListElement>(null)
  const lastFocus = useRef<HTMLElement | null>(null)
  const detailRequest = useRef<AbortController | null>(null)
  const jobsRequestId = useRef(0)
  const initialFetchSkipped = useRef(false)
  const debouncedSearch = useDebouncedValue(jobFilters.search, 280)
  const requestFilters = useMemo(() => ({ ...jobFilters, search: debouncedSearch.trim().length >= 2 ? debouncedSearch : '' }), [jobFilters, debouncedSearch])
  useEffect(() => {
    const url = new URL(window.location.href)
    if (url.searchParams.get('askAi') !== '1') return
    setAiOpen(true)
    url.searchParams.delete('askAi')
    window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}${url.hash}`)
  }, [])
  useEffect(() => {
    if (!initialFetchSkipped.current && initialData && initialData.jobs.length > 0 && jobPage === 1 && !requestFilters.search && requestFilters.country === initialCountry && !requestFilters.role) {
      initialFetchSkipped.current = true
      setJobsLoading(false)
      return
    }
    const controller = new AbortController()
    const requestId = ++jobsRequestId.current
    setJobsLoading(true)
    setJobsError('')
    const query = new URLSearchParams({ page: String(jobPage), pageSize: '40' })
    if (requestFilters.search.trim()) query.set('search', requestFilters.search.trim())
    if (requestFilters.country) query.set('country', requestFilters.country)
    else if (countryResolved) query.set('country', 'all')
    if (requestFilters.role) query.set('role', requestFilters.role)
    fetch(`/api/jobs?${query}`, { signal: controller.signal, cache: 'no-cache' })
      .then((res) => res.ok ? res.json() as Promise<{ jobs?: Job[]; total?: number; page?: number; countries?: string[]; roles?: string[]; selectedCountry?: string }> : Promise.reject())
      .then((data) => {
        if (controller.signal.aborted || requestId !== jobsRequestId.current) return
        setCatalog(data.jobs ?? [])
        setJobTotal(data.total ?? 0)
        setJobOptions({ countries: data.countries ?? [], roles: data.roles ?? [] })
        if (!countryResolved) {
          setCountryResolved(true)
          setJobFilters((current) => ({ ...current, country: data.selectedCountry ?? '' }))
        }
        if (data.page && data.page !== jobPage) setJobPage(data.page)
      })
      .catch((error: unknown) => { if ((error as { name?: string })?.name !== 'AbortError' && requestId === jobsRequestId.current) setJobsError('Unable to refresh roles. Please try again.') })
      .finally(() => { if (!controller.signal.aborted && requestId === jobsRequestId.current) setJobsLoading(false) })
    return () => controller.abort()
  }, [jobPage, requestFilters, countryResolved, initialCountry, initialData])
  const updateJobFilters = (next: { search: string; country: string; role: string }) => { setJobFilters(next); setJobPage(1) }
  const totalPages = Math.max(1, Math.ceil(jobTotal / 40))
  const loadJobDetails = useCallback((job: Job) => {
    detailRequest.current?.abort()
    const controller = new AbortController()
    detailRequest.current = controller
    fetch(`/api/jobs/${encodeURIComponent(job.id)}`, { signal: controller.signal })
      .then((response) => response.ok ? response.json() as Promise<{ data?: Job }> : Promise.reject())
      .then((payload) => { if (payload.data) setSelected((current) => current?.id === job.id ? payload.data! : current) })
      .catch(() => { /* keep the safe summary visible when details are unavailable */ })
  }, [])
  const openJob = (job: Job) => { lastFocus.current = document.activeElement as HTMLElement; setSelected(job); loadJobDetails(job); history.pushState({ job: job.id }, '', jobPath(job)) }
  const closeJob = useCallback((fromHistory = false) => { detailRequest.current?.abort(); setSelected(null); if (!fromHistory && (location.pathname.startsWith('/jobs/') || location.hash.startsWith('#job='))) history.replaceState(null, '', `/${location.search}`); requestAnimationFrame(() => lastFocus.current?.focus()) }, [])
  useEffect(() => { const fromHistory = () => { const pathId = location.pathname.match(/^\/jobs\/([^/]+)/)?.[1]; const hashId = location.hash.startsWith('#job=') ? location.hash.slice(5) : null; const id = pathId ? decodeURIComponent(pathId) : hashId; const job = id ? catalog.find((item) => item.id === id || publicJobId(item.id) === publicJobId(id)) : null; if (job) { setSelected(job); loadJobDetails(job) } else if (!id) setSelected(null) }; window.addEventListener('popstate', fromHistory); fromHistory(); return () => window.removeEventListener('popstate', fromHistory) }, [catalog, loadJobDetails])
  return <><div className="page-field" aria-hidden="true"/><Dock theme={theme} setTheme={setTheme} compact={compact} setCompact={setCompact} onAskAI={() => setAiOpen(true)}/><AskAi key={String(aiOpen)} initialOpen={aiOpen} showLauncher={false} onClose={() => setAiOpen(false)} /><main className={`shell${compact ? ' density-compact' : ''}`} id="top"><span className="rail-tick r-hdr" aria-hidden="true">HDR 01</span><span className="rail-tick r-pst" aria-hidden="true">PST 44</span><span className="rail-tick r-con" aria-hidden="true">CON 02</span><span className="rail-tick r-dis" aria-hidden="true">DIS 03</span><span className="rail-tick r-fot" aria-hidden="true">FOT 04</span><span className="rail-tick r-col" aria-hidden="true">COL 05</span><Hero/><JobsSection jobs={catalog} total={jobTotal} page={jobPage} totalPages={totalPages} loading={jobsLoading} filters={jobFilters} options={jobOptions} onFiltersChange={updateJobFilters} onPageChange={setJobPage} listRef={listRef} onOpen={openJob}/>{jobsError && <p className="results-error" role="alert">{jobsError}</p>}<Editorial/><Footer/></main><DetailModal job={selected} onClose={() => closeJob()}/></>
}
