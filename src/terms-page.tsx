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

export function TermsPage() {
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
            <h1>Terms of Service</h1>
            <p>Welcome to Findmeajob. By accessing or using our platform, you agree to comply with and be bound by the following Terms of Service.</p>
          </section>

          <section className="section">
            <h2>1. Platform Purpose &amp; Disclaimer</h2>
            <p>Findmeajob is an independent job board aggregator designed to showcase Tech &amp; Software Engineering roles. All job listings redirect candidates to the respective official company career portals or ATS pages. Findmeajob is not affiliated with, endorsed by, or sponsored by any of the listed companies.</p>
          </section>

          <section className="section">
            <h2>2. Accounts and Ask AI</h2>
            <p>Ask AI requires Google sign-in. Each account may receive up to 200 successful AI answers per UTC day; failed requests and service errors do not use that allowance. You may not automate, share accounts to evade limits, probe the service, or otherwise abuse or disrupt the platform.</p>
          </section>

          <section className="section">
            <h2>3. External Links</h2>
            <p>Our website contains links to third-party official careers pages and external websites. We do not control or take responsibility for the content, privacy practices, or availability of third-party portals.</p>
          </section>

          <section className="section">
            <h2>4. Changes to Terms</h2>
            <p>We reserve the right to update these terms at any time. Continued use of Findmeajob constitutes your acceptance of any updated terms.</p>
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
