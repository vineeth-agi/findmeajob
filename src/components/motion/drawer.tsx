import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { useEffect, useRef, type ReactNode } from 'react'
import './drawer.css'

export interface DrawerProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  side?: 'left' | 'right'
  children: ReactNode
  className?: string
  backdropClassName?: string
  ariaLabel?: string
  dismissable?: boolean
}

/** Accessible modal drawer that freezes the document without losing scroll. */
export function Drawer({
  open,
  onOpenChange,
  side = 'right',
  children,
  className = '',
  backdropClassName = '',
  ariaLabel,
  dismissable = true,
}: DrawerProps) {
  const reduce = useReducedMotion()
  const panelRef = useRef<HTMLElement>(null)

  useEffect(() => {
    if (!open) return
    document.documentElement.dataset.aiDrawerOpen = 'true'
    const scrollY = window.scrollY
    const root = document.documentElement
    const body = document.body
    const shell = document.querySelector<HTMLElement>('.shell')
    const dock = document.querySelector<HTMLElement>('.de-dock')
    const previous = {
      rootOverflow: root.style.overflow,
      rootOverscrollBehavior: root.style.overscrollBehavior,
      bodyOverflow: body.style.overflow,
      bodyPosition: body.style.position,
      bodyTop: body.style.top,
      bodyLeft: body.style.left,
      bodyRight: body.style.right,
      bodyWidth: body.style.width,
      shellInert: shell?.inert ?? false,
      dockInert: dock?.inert ?? false,
    }
    root.style.overflow = 'hidden'
    root.style.overscrollBehavior = 'none'
    body.style.overflow = 'hidden'
    body.style.position = 'fixed'
    body.style.top = `-${scrollY}px`
    body.style.left = '0'
    body.style.right = '0'
    body.style.width = '100%'
    if (shell) shell.inert = true
    if (dock) dock.inert = true
    const focusable = () => Array.from(panelRef.current?.querySelectorAll<HTMLElement>('a[href],button:not([disabled]),textarea:not([disabled]),input:not([disabled]),select:not([disabled]),[tabindex]:not([tabindex="-1"])') ?? [])
    const focusFrame = window.requestAnimationFrame(() => {
      if (!panelRef.current?.contains(document.activeElement)) (focusable()[0] ?? panelRef.current)?.focus()
    })
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && dismissable) {
        event.preventDefault()
        onOpenChange(false)
        return
      }
      if (event.key !== 'Tab') return
      const elements = focusable()
      if (!elements.length) {
        event.preventDefault()
        panelRef.current?.focus()
        return
      }
      const first = elements[0]
      const last = elements[elements.length - 1]
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.cancelAnimationFrame(focusFrame)
      delete document.documentElement.dataset.aiDrawerOpen
      root.style.overflow = previous.rootOverflow
      root.style.overscrollBehavior = previous.rootOverscrollBehavior
      body.style.overflow = previous.bodyOverflow
      body.style.position = previous.bodyPosition
      body.style.top = previous.bodyTop
      body.style.left = previous.bodyLeft
      body.style.right = previous.bodyRight
      body.style.width = previous.bodyWidth
      if (shell) shell.inert = previous.shellInert
      if (dock) dock.inert = previous.dockInert
      window.scrollTo(0, scrollY)
    }
  }, [dismissable, open, onOpenChange])

  const offscreen = side === 'right' ? '100%' : '-100%'

  return <AnimatePresence>
    {open && <div className="fmj-drawer-root">
      <motion.div
        aria-hidden="true"
        onClick={() => dismissable && onOpenChange(false)}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
        className={`fmj-drawer-backdrop ${backdropClassName}`}
      />
      <motion.aside
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={ariaLabel}
        tabIndex={-1}
        initial={reduce ? { opacity: 0 } : { x: offscreen }}
        animate={reduce ? { opacity: 1 } : { x: 0 }}
        exit={reduce ? { opacity: 0 } : { x: offscreen }}
        transition={reduce ? { duration: 0.2, ease: [0.16, 1, 0.3, 1] } : { type: 'spring', stiffness: 420, damping: 40, mass: 0.5 }}
        className={`fmj-drawer-panel fmj-drawer-panel-${side} ${className}`}
      >
        {children}
      </motion.aside>
    </div>}
  </AnimatePresence>
}
