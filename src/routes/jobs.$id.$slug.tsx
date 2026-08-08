import { createFileRoute, Link, notFound } from '@tanstack/react-router'
import { getJobById } from '../server-functions/jobs'
import { jobPath, type Job } from '../shared/jobs'
import { serializeJsonLd, SITE_ORIGIN, SOCIAL_IMAGE_META } from '../shared/seo'

const siteName = 'Findmeajob'

const jobDescription = (job: Job) => [
  job.description,
  job.responsibilities.length ? `Responsibilities:\n${job.responsibilities.join('\n')}` : '',
  job.requirements.length ? `Requirements:\n${job.requirements.join('\n')}` : '',
  job.benefits.length ? `Benefits:\n${job.benefits.join('\n')}` : '',
  job.extras.length ? `Additional details:\n${job.extras.join('\n')}` : '',
].filter(Boolean).join('\n\n')

const jobPostingSchema = (job: Job, url: string) => ({
  '@context': 'https://schema.org',
  '@type': 'JobPosting',
  title: job.role,
  description: jobDescription(job),
  datePosted: job.datePosted,
  dateModified: job.dateModified,
  url,
  directApply: Boolean(job.applyUrl),
  hiringOrganization: { '@type': 'Organization', name: job.company },
  jobLocation: job.locations.map((location) => ({
    '@type': 'Place',
    address: { '@type': 'PostalAddress', addressLocality: location },
  })),
  ...(job.employmentType ? { employmentType: job.employmentType } : {}),
  ...(job.workMode?.toLowerCase().includes('remote') ? { jobLocationType: 'TELECOMMUTE' } : {}),
})

export const Route = createFileRoute('/jobs/$id/$slug')({
  loader: async ({ params }) => {
    const job = await getJobById({ data: { id: params.id } })
    if (!job) throw notFound()
    return { job }
  },
  head: ({ loaderData, params }) => {
    const job = loaderData?.job
    const title = job ? `${job.role} at ${job.company} | ${siteName}` : siteName
    const description = job ? `${job.role} at ${job.company}. ${job.locations.join(', ')}. Apply directly through Findmeajob.` : 'Tech and software engineering jobs on Findmeajob.'
    const canonical = `${SITE_ORIGIN}${job ? jobPath(job) : `/jobs/${encodeURIComponent(params.id)}/${params.slug}`}`
    return {
      meta: [
        { title },
        { name: 'description', content: description.slice(0, 160) },
        { property: 'og:type', content: 'website' },
        { property: 'og:title', content: title },
        { property: 'og:description', content: description.slice(0, 160) },
        ...SOCIAL_IMAGE_META,
        { name: 'twitter:title', content: title },
        { name: 'twitter:description', content: description.slice(0, 160) },
      ],
      links: [{ rel: 'canonical', href: canonical }],
    }
  },
  component: JobPage,
})

function JobPage() {
  const { job } = Route.useLoaderData()
  const canonical = `${SITE_ORIGIN}${jobPath(job)}`
  return <main className="job-page shell" id="top">
    <nav className="job-page-nav" aria-label="Job navigation"><Link to="/">← All jobs</Link></nav>
    <article className="job-detail-page">
      <header className="job-detail-header">
        <div className="logo-wrap"><img src={job.logoUrl} alt={`${job.company} logo`} width="64" height="64" decoding="async" onError={(event) => { event.currentTarget.style.display = 'none' }}/><span className="fallback">{job.company[0]}</span></div>
        <div>
          <p className="job-company">{job.company}</p>
          <h1>{job.role}</h1>
          <div className="job-detail-meta"><span>{job.locations.join(' · ')}</span>{job.compensation.length ? <span>{job.compensation.join(' · ')}</span> : null}<span>{job.posted}</span></div>
        </div>
      </header>
      <div className="job-detail-content">
        {job.companyAbout ? <section><h2>About the company</h2><p>{job.companyAbout}</p></section> : null}
        <section><h2>About the role</h2><p>{job.description || 'Role details are available on the company application page.'}</p></section>
        {job.responsibilities.length ? <section><h2>Responsibilities</h2><ul>{job.responsibilities.map((item) => <li key={item}>{item}</li>)}</ul></section> : null}
        {job.requirements.length ? <section><h2>Requirements</h2><ul>{job.requirements.map((item) => <li key={item}>{item}</li>)}</ul></section> : null}
        {job.benefits.length ? <section><h2>Benefits</h2><ul>{job.benefits.map((item) => <li key={item}>{item}</li>)}</ul></section> : null}
        {job.extras.length ? <section><h2>Additional details</h2><ul>{job.extras.map((item) => <li key={item}>{item}</li>)}</ul></section> : null}
      </div>
      {job.applyUrl ? <a className="apply job-page-apply" href={job.applyUrl} target="_blank" rel="noopener noreferrer">Apply for this role <span aria-hidden="true">↗</span></a> : null}
    </article>
    <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: serializeJsonLd(jobPostingSchema(job, canonical)) }} />
  </main>
}
