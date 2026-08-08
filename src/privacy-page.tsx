import { useEffect, useState, useCallback } from 'react'
import { Dock, type DockTheme } from './dock'
import { FooterScene } from './footer-scene'

function resolveInitialDockTheme(): DockTheme {
  if (typeof window === 'undefined') return 'dark'
  const storedTheme = window.localStorage.getItem('de-theme')
  if (storedTheme === 'light' || storedTheme === 'dark') return storedTheme
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

function useDockTheme() {
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

export function PrivacyPage() {
  const [theme, setTheme] = useDockTheme()
  const [compact, setCompact] = useState(false)

  return (
    <>
      <div className="page-field" aria-hidden="true" />
      <Dock theme={theme} setTheme={setTheme} compact={compact} setCompact={setCompact} onAskAI={() => { window.location.href = '/?askAi=1' }} />
      <main className="shell" id="top">
        <header>
          <div className="mast">
            <a className="wordmark" href="/" aria-label="Findmeajob home">
              Findme<br />ajob
            </a>
            <a className="submit" href="/">Back to Jobs ↗</a>
          </div>
        </header>

        <article className="editorial" style={{ paddingTop: '32px' }}>
          <section className="section intro">
            <h1>Privacy Policy</h1>
            <p>At Findmeajob, we prioritize user privacy above all else. This Privacy Policy outlines how your data is handled when you visit our website.</p>
          </section>

          <section className="section">
            <h2>1. Account Information</h2>
            <p>Ask AI uses Google sign-in. We store the account and session information needed to provide that feature, such as your Google account identifier, email address, display name, profile image, and session records. Authentication cookies are HTTP-only and are not available to page scripts.</p>
          </section>

          <section className="section">
            <h2>2. AI Requests and Usage</h2>
            <p>Your Ask AI question, up to six recent conversation messages, and relevant job-catalog context are sent from our server to OpenAI to generate an answer. Users do not provide API keys. We request that OpenAI not store these responses, and our application stores the successful daily usage count rather than the chat transcript. Failed requests do not count toward the daily allowance.</p>
          </section>

          <section className="section">
            <h2>3. Other Information</h2>
            <p>We do not sell user personal data or use intrusive third-party advertising trackers. Basic security and operational records may be processed to prevent abuse and keep the service reliable.</p>
          </section>

          <section className="section">
            <h2>4. Direct External Applications</h2>
            <p>When you click on job listings, you are routed directly to official company career pages. Once on an external site, your interaction is governed by that company&apos;s respective privacy policy.</p>
          </section>

          <section className="section">
            <h2>5. Contact &amp; Support</h2>
            <p>If you have any questions or feedback regarding our privacy practices, you can reach out via GitHub or Twitter/X.</p>
          </section>
        </article>

        <footer className="footer">
          <a className="wordmark" href="/">Findme<br />ajob</a>
          <div className="strap"><a href="https://x.com/vineeth_agi" target="_blank" rel="noopener" style={{ color: 'inherit', textDecoration: 'none' }}>Built by Vineeth ↗</a></div>
          <div className="copyright">
            <strong>© Copyright</strong>{new Date().getFullYear()}&nbsp;&nbsp;&nbsp; Findmeajob
          </div>
          <FooterScene />
        </footer>
      </main>
    </>
  )
}
