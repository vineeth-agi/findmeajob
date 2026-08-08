import { createFileRoute } from '@tanstack/react-router'
import { PrivacyPage } from '../privacy-page'
import { SITE_ORIGIN } from '../shared/seo'

export const Route = createFileRoute('/privacy')({
  head: () => ({
    meta: [
      { title: 'Privacy Policy | Findmeajob' },
      { name: 'description', content: 'How Findmeajob handles account, session, and Ask AI data.' },
    ],
    links: [{ rel: 'canonical', href: `${SITE_ORIGIN}/privacy` }],
  }),
  component: PrivacyPage,
})
