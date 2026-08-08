import type { ReactNode } from 'react'
import {
  createRootRoute,
  HeadContent,
  Outlet,
  Scripts,
} from '@tanstack/react-router'
import { SOCIAL_IMAGE_META } from '../shared/seo'
import '../styles.css'

const OPENPANEL_CLIENT_ID = 'e9f7c500-a3cc-417a-a46d-127dd0924785'
const OPENPANEL_BOOTSTRAP = `
window.op=window.op||function(){var n=[];return new Proxy(function(){arguments.length&&n.push([].slice.call(arguments))},{get:function(t,r){return"q"===r?n:function(){n.push([r].concat([].slice.call(arguments)))}} ,has:function(t,r){return"q"===r}}) }();
window.op('init', {
  clientId: '${OPENPANEL_CLIENT_ID}',
  trackScreenViews: true,
  trackOutgoingLinks: true,
  trackAttributes: true,
  disabled: window.location.hostname !== 'findmeajob.dev',
});
`

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: 'utf-8' },
      { name: 'viewport', content: 'width=device-width, initial-scale=1' },
      { title: 'Findmeajob - Tech & Software Engineering Jobs' },
      {
        name: 'description',
        content: 'Find official tech and software engineering jobs from company career pages. Browse roles, locations, and compensation, then apply directly.',
      },
      { name: 'theme-color', content: '#111111' },
      { property: 'og:type', content: 'website' },
      { property: 'og:site_name', content: 'Findmeajob' },
      { property: 'og:title', content: 'Findmeajob - Tech & Software Engineering Jobs' },
      { property: 'og:description', content: 'Find official tech and software engineering jobs and apply directly.' },
      ...SOCIAL_IMAGE_META,
      { name: 'twitter:title', content: 'Findmeajob - Tech & Software Engineering Jobs' },
      { name: 'twitter:description', content: 'Find official tech and software engineering jobs and apply directly.' },
    ],
    links: [
      { rel: 'icon', href: '/favicon.svg', type: 'image/svg+xml' },
    ],
  }),
  component: RootDocument,
})

function RootDocument() {
  return (
    <DocumentShell>
      <Outlet />
    </DocumentShell>
  )
}

function DocumentShell({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="en">
      <head>
        <HeadContent />
        {import.meta.env.PROD && (
          <>
            <script dangerouslySetInnerHTML={{ __html: OPENPANEL_BOOTSTRAP }} />
            <script src="https://openpanel.dev/op1.js" defer async />
          </>
        )}
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  )
}
