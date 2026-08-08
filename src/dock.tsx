import type { ReactNode } from 'react'
import './dock.css'

export type DockTheme = 'light' | 'dark'

export type DockProps = {
  theme: DockTheme
  setTheme: (theme: DockTheme) => void
  compact: boolean
  setCompact: (compact: boolean) => void
  onAskAI: () => void
}

function DockIcon({ children }: { children: ReactNode }) {
  return <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">{children}</svg>
}

function DockButton({
  label,
  active,
  onClick,
  children,
}: {
  label: string
  active?: boolean
  onClick: () => void
  children: ReactNode
}) {
  return (
    <button
      className={`de-dock__button${active ? ' is-active' : ''}`}
      type="button"
      aria-label={label}
      aria-pressed={active}
      onClick={onClick}
    >
      <span className="de-dock__icon">{children}</span>
      <span className="de-dock__label">{label}</span>
    </button>
  )
}

/**
 * The floating utility dock. It intentionally only owns presentation and
 * callbacks, making it safe to mount on the homepage.
 */
export function Dock({ theme, setTheme, compact, setCompact, onAskAI }: DockProps) {
  const nextTheme: DockTheme = theme === 'dark' ? 'light' : 'dark'

  return (
    <nav className="de-dock" aria-label="Site controls">
      <div className="de-dock__rail" role="toolbar" aria-label="Display controls">
        <DockButton label={`Switch to ${nextTheme} theme`} active={theme === 'dark'} onClick={() => setTheme(nextTheme)}>
          <DockIcon>
            {theme === 'dark' ? (
              <path d="M20.2 15.2A8.2 8.2 0 0 1 8.8 3.8 8.2 8.2 0 1 0 20.2 15.2Z" />
            ) : (
              <>
                <circle cx="12" cy="12" r="3.2" />
                <path d="M12 2v2.2M12 19.8V22M2 12h2.2M19.8 12H22M4.9 4.9l1.6 1.6M17.5 17.5l1.6 1.6M19.1 4.9l-1.6 1.6M6.5 17.5l-1.6 1.6" />
              </>
            )}
          </DockIcon>
        </DockButton>
        <span className="de-dock__separator" aria-hidden="true" />
        <DockButton label={compact ? 'Use spacious list' : 'Use compact list'} active={compact} onClick={() => setCompact(!compact)}>
          <DockIcon>
            <path d="M5 6h14M5 12h14M5 18h14" />
            <circle cx="3" cy="6" r=".65" fill="currentColor" stroke="none" />
            <circle cx="3" cy="12" r=".65" fill="currentColor" stroke="none" />
            <circle cx="3" cy="18" r=".65" fill="currentColor" stroke="none" />
          </DockIcon>
        </DockButton>
        <span className="de-dock__separator" aria-hidden="true" />
        <button className="de-dock__ask" type="button" onClick={onAskAI} aria-label="Open Ask AI">
          <span className="de-dock__ask-icon" aria-hidden="true"><DockIcon><path d="m12 2 1.7 6.3L20 10l-6.3 1.7L12 18l-1.7-6.3L4 10l6.3-1.7L12 2Z" /><path d="m19 15 .7 2.3L22 18l-2.3.7L19 21l-.7-2.3L16 18l2.3-.7L19 15Z" /></DockIcon></span><span>Ask AI</span>
        </button>
      </div>
    </nav>
  )
}

export default Dock
