import { createFileRoute } from '@tanstack/react-router'
import { HomePage } from '../home-page'
import { getInitialJobs } from '../server-functions/jobs'
import { SITE_ORIGIN } from '../shared/seo'

export const Route = createFileRoute('/')({
  loader: () => getInitialJobs(),
  head: () => ({
    meta: [
      { title: 'Findmeajob - Tech & Software Engineering Jobs' },
      { name: 'description', content: 'Find official tech and software engineering jobs from company career pages and apply directly.' },
    ],
    links: [{ rel: 'canonical', href: `${SITE_ORIGIN}/` }],
  }),
  component: HomeRoute,
})

function HomeRoute() {
  return <HomePage initialData={Route.useLoaderData()} />
}
