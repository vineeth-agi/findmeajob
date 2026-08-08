import { createFileRoute } from '@tanstack/react-router'
import { TermsPage } from '../terms-page'
import { SITE_ORIGIN } from '../shared/seo'

export const Route = createFileRoute('/terms')({
  head: () => ({
    meta: [
      { title: 'Terms of Service | Findmeajob' },
      { name: 'description', content: 'Terms for using Findmeajob and its job-search assistant.' },
    ],
    links: [{ rel: 'canonical', href: `${SITE_ORIGIN}/terms` }],
  }),
  component: TermsPage,
})
