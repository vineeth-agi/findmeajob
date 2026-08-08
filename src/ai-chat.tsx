import {
  type FormEvent,
  type KeyboardEvent,
  type RefObject,
  useEffect,
  useRef,
  useState,
} from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { Drawer } from './components/motion/drawer'
import './ai-chat.css'

const DAILY_LIMIT = 200

export type AskAiMessage = {
  id: string
  role: 'user' | 'assistant'
  content: string
  sources?: AskAiSource[]
  matches?: MatchSummary
  isError?: boolean
}
type MatchSummary = { total: number; shown: number; truncated: boolean }
export type AskAiSource = {
  id?: string
  company?: string
  role?: string
  location?: string
  locations?: string[]
  applyUrl?: string
  workMode?: string
  employmentType?: string
}
export interface AskAiProps {
  initialOpen?: boolean
  jobContext?: string
  showLauncher?: boolean
  onClose?: () => void
}

type AuthUser = { id: string; name?: string | null; email: string }
type DailyUsage = { limit: number; used: number; remaining: number; resetsAt?: string | null }
type ChatResponse = { answer: string; sources?: AskAiSource[]; matches?: MatchSummary; usage?: DailyUsage }
type JsonRecord = Record<string, unknown>

const makeId = () => `${Date.now()}-${Math.random().toString(36).slice(2)}`

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null
}

function readUser(payload: unknown): AuthUser | null {
  if (!isRecord(payload)) return null
  const candidate = isRecord(payload.user)
    ? payload.user
    : isRecord(payload.data) && isRecord(payload.data.user)
      ? payload.data.user
      : null
  if (!candidate || typeof candidate.id !== 'string' || typeof candidate.email !== 'string') return null
  return {
    id: candidate.id,
    email: candidate.email,
    name: typeof candidate.name === 'string' ? candidate.name : null,
  }
}

function readUsage(payload: unknown): DailyUsage | null {
  if (!isRecord(payload)) return null
  const limit = typeof payload.limit === 'number' ? payload.limit : DAILY_LIMIT
  const used = typeof payload.used === 'number' ? payload.used : null
  const remaining = typeof payload.remaining === 'number' ? payload.remaining : used === null ? null : Math.max(0, limit - used)
  if (used === null || remaining === null) return null
  return {
    limit: Math.max(0, limit),
    used: Math.max(0, used),
    remaining: Math.max(0, remaining),
    resetsAt: typeof payload.resetsAt === 'string' ? payload.resetsAt : null,
  }
}

function errorMessage(payload: unknown, fallback: string) {
  if (!isRecord(payload)) return fallback
  if (typeof payload.message === 'string') return payload.message
  if (typeof payload.error === 'string') return payload.error
  if (isRecord(payload.error) && typeof payload.error.message === 'string') return payload.error.message
  return fallback
}

function resetLabel(resetsAt?: string | null) {
  if (!resetsAt) return 'Resets daily'
  const date = new Date(resetsAt)
  if (Number.isNaN(date.getTime())) return 'Resets daily'
  return `Resets ${new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit', timeZoneName: 'short' }).format(date)}`
}

const displayMetadata = (value?: string) => value?.replace(/[_-]+/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase()) || ''

/** Lightweight reveal animation for completed server responses. */
function StreamingResponse({ text, onProgress }: { text: string; onProgress?: () => void }) {
  const [visible, setVisible] = useState('')
  useEffect(() => {
    let cursor = 0
    let frame = 0
    setVisible('')
    const reveal = () => {
      cursor = Math.min(text.length, cursor + Math.max(1, Math.ceil((text.length - cursor) / 22)))
      setVisible(text.slice(0, cursor))
      onProgress?.()
      if (cursor < text.length) frame = window.requestAnimationFrame(reveal)
    }
    frame = window.requestAnimationFrame(reveal)
    return () => window.cancelAnimationFrame(frame)
  }, [text])
  return <div className="ai-markdown-response">
    <ReactMarkdown remarkPlugins={[remarkGfm]}>{visible}</ReactMarkdown>
    {visible.length < text.length && <span className="ai-streaming-caret" aria-hidden="true" />}
  </div>
}

function PromptInput({ draft, setDraft, onSubmit, onKeyDown, inputRef, loading, disabled }: {
  draft: string
  setDraft: (value: string) => void
  onSubmit: (event: FormEvent) => void
  onKeyDown: (event: KeyboardEvent<HTMLTextAreaElement>) => void
  inputRef: RefObject<HTMLTextAreaElement | null>
  loading: boolean
  disabled: boolean
}) {
  return <form className="ai-prompt-input" onSubmit={onSubmit}>
    <textarea
      ref={inputRef}
      value={draft}
      onChange={(event) => setDraft(event.target.value)}
      onKeyDown={onKeyDown}
      placeholder={disabled ? 'Daily question limit reached' : 'Ask a question...'}
      rows={2}
      aria-label="Ask a question"
      disabled={loading || disabled}
    />
    <div className="ai-prompt-input-footer">
      <span>{disabled ? 'Your limit resets automatically' : 'Enter to send · Shift + Enter for a new line'}</span>
      <button type="submit" aria-label="Send question" disabled={loading || disabled || !draft.trim()}>↑</button>
    </div>
  </form>
}

function AuthGate() {
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  const continueWithGoogle = async () => {
    if (submitting) return
    setSubmitting(true)
    setError('')
    try {
      const callbackURL = new URL(window.location.href)
      callbackURL.searchParams.set('askAi', '1')
      callbackURL.hash = ''
      const response = await fetch('/api/auth/sign-in/social', {
        method: 'POST',
        credentials: 'include',
        headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider: 'google', callbackURL: callbackURL.href }),
      })
      const payload: unknown = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(errorMessage(payload, 'Google sign-in could not start.'))
      if (!isRecord(payload) || typeof payload.url !== 'string') throw new Error('Google sign-in did not return a secure redirect URL.')

      const destination = new URL(payload.url, window.location.origin)
      const isSameOrigin = destination.origin === window.location.origin
      const isGoogleAccount = destination.protocol === 'https:' && destination.hostname === 'accounts.google.com'
      if (!isSameOrigin && !isGoogleAccount) throw new Error('Google sign-in returned an unexpected redirect URL.')
      window.location.assign(destination.href)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Google sign-in is unavailable right now.')
      setSubmitting(false)
    }
  }

  return <div className="ai-auth-gate">
    <div className="ai-auth-card">
      <p className="ai-auth-eyebrow">PRIVATE AI ACCESS</p>
      <h3>Sign in to Ask AI</h3>
      <p className="ai-auth-copy">Continue with Google to protect the assistant and use up to {DAILY_LIMIT} successful questions each day.</p>
      {error && <p className="ai-auth-error" role="alert">{error}</p>}
      <button className="ai-auth-google" type="button" onClick={() => void continueWithGoogle()} disabled={submitting} autoFocus>
        <svg aria-hidden="true" viewBox="0 0 24 24"><path fill="#4285f4" d="M21.6 12.2c0-.7-.1-1.4-.2-2H12v3.9h5.4a4.6 4.6 0 0 1-2 3v2.5h3.2c1.9-1.7 3-4.3 3-7.4Z"/><path fill="#34a853" d="M12 22c2.7 0 5-.9 6.6-2.4l-3.2-2.5c-.9.6-2 1-3.4 1a5.8 5.8 0 0 1-5.5-4H3.2v2.6A10 10 0 0 0 12 22Z"/><path fill="#fbbc05" d="M6.5 14.1a6 6 0 0 1 0-4.2V7.3H3.2a10 10 0 0 0 0 9.4l3.3-2.6Z"/><path fill="#ea4335" d="M12 5.9c1.5 0 2.9.5 4 1.5l2.7-2.7A9 9 0 0 0 12 2a10 10 0 0 0-8.8 5.3l3.3 2.6a5.8 5.8 0 0 1 5.5-4Z"/></svg>
        <span>{submitting ? 'Opening Google…' : 'Continue with Google'}</span>
      </button>
      <p className="ai-auth-note">Failed requests and server errors do not use your daily allowance.</p>
    </div>
  </div>
}

export function AskAi({ initialOpen = false, jobContext, showLauncher = true, onClose }: AskAiProps) {
  const [open, setOpen] = useState(initialOpen)
  const [menuOpen, setMenuOpen] = useState(false)
  const [authLoading, setAuthLoading] = useState(false)
  const [authChecked, setAuthChecked] = useState(false)
  const [user, setUser] = useState<AuthUser | null>(null)
  const [usage, setUsage] = useState<DailyUsage | null>(null)
  const [usageLoading, setUsageLoading] = useState(false)
  const [draft, setDraft] = useState('')
  const [loading, setLoading] = useState(false)
  const [messages, setMessages] = useState<AskAiMessage[]>([])
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const threadRef = useRef<HTMLDivElement>(null)

  const loadUsage = async () => {
    setUsageLoading(true)
    try {
      const response = await fetch('/api/ai/usage', { credentials: 'include', headers: { Accept: 'application/json' } })
      const payload: unknown = await response.json().catch(() => ({}))
      if (response.status === 401) {
        setUser(null)
        setUsage(null)
        return
      }
      if (response.ok) setUsage(readUsage(payload))
    } finally {
      setUsageLoading(false)
    }
  }

  useEffect(() => {
    if (!open || authChecked) return
    let active = true
    setAuthLoading(true)
    void fetch('/api/auth/get-session', { credentials: 'include', headers: { Accept: 'application/json' } })
      .then(async (response) => ({ response, payload: await response.json().catch(() => ({})) as unknown }))
      .then(({ response, payload }) => {
        if (!active) return
        setUser(response.ok ? readUser(payload) : null)
        setAuthChecked(true)
      })
      .catch(() => { if (active) { setUser(null); setAuthChecked(true) } })
      .finally(() => { if (active) setAuthLoading(false) })
    return () => { active = false }
  }, [open, authChecked])

  useEffect(() => { if (user) void loadUsage() }, [user?.id])
  useEffect(() => {
    if (!menuOpen || typeof document === 'undefined') return
    const closeOnOutside = (event: MouseEvent) => { if (!menuRef.current?.contains(event.target as Node)) setMenuOpen(false) }
    document.addEventListener('mousedown', closeOnOutside)
    return () => document.removeEventListener('mousedown', closeOnOutside)
  }, [menuOpen])
  useEffect(() => { if (open && user) window.setTimeout(() => inputRef.current?.focus(), 160) }, [open, user])

  const scrollToLatest = () => {
    const thread = threadRef.current
    if (thread) thread.scrollTop = thread.scrollHeight
  }
  useEffect(() => { if (open) requestAnimationFrame(scrollToLatest) }, [messages, loading, open])

  const clearChat = () => setMessages([])
  const copyConversation = async () => {
    if (typeof navigator === 'undefined') return
    const transcript = messages.map((message) => `${message.role === 'user' ? 'You' : 'Ask AI'}: ${message.content}`).join('\n\n')
    if (!transcript) return
    try { await navigator.clipboard.writeText(transcript) } catch { /* Clipboard permission is optional. */ }
  }
  const shareConversation = async () => {
    const transcript = messages.map((message) => `${message.role === 'user' ? 'You' : 'Ask AI'}: ${message.content}`).join('\n\n')
    if (typeof navigator !== 'undefined' && 'share' in navigator) {
      try { await navigator.share({ title: 'Findmeajob · Ask AI', text: transcript }) } catch { /* Share sheet dismissed. */ }
    } else await copyConversation()
  }

  const signOut = async () => {
    try {
      await fetch('/api/auth/sign-out', {
        method: 'POST',
        credentials: 'include',
        headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
        body: '{}',
      })
    } finally {
      setUser(null)
      setUsage(null)
      setMessages([])
      setDraft('')
      setMenuOpen(false)
      setAuthChecked(true)
    }
  }

  const sendQuestion = async (event?: FormEvent) => {
    event?.preventDefault()
    const question = draft.trim()
    if (!question || loading || !user || usage?.remaining === 0) return
    setDraft('')
    setMessages((current) => [...current, { id: makeId(), role: 'user', content: question }])
    setLoading(true)
    try {
      const response = await fetch('/api/ai/chat', {
        method: 'POST',
        credentials: 'include',
        headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
        body: JSON.stringify({
          query: question,
          ...(jobContext ? { jobContext } : {}),
          history: messages.filter((message) => !message.isError).slice(-6).map(({ role, content }) => ({ role, content })),
        }),
      })
      const payload: unknown = await response.json().catch(() => ({}))
      if (response.status === 401) {
        setUser(null)
        setUsage(null)
        setAuthChecked(true)
        throw new Error('Your session expired. Sign in again to continue.')
      }
      if (response.status === 429) {
        void loadUsage()
        throw new Error(errorMessage(payload, 'You have used all 200 questions for today. Your allowance will reset automatically.'))
      }
      if (!response.ok) throw new Error(errorMessage(payload, 'The assistant could not answer right now. This request was not counted.'))
      if (!isRecord(payload) || typeof payload.answer !== 'string' || !payload.answer.trim()) throw new Error('The assistant returned an empty response. This request was not counted.')
      const result = payload as ChatResponse
      setMessages((current) => [...current, { id: makeId(), role: 'assistant', content: result.answer.trim(), sources: Array.isArray(result.sources) ? result.sources : [], matches: result.matches }])
      // Usage is changed only when the server confirms a successful answer.
      const confirmedUsage = readUsage(result.usage)
      if (confirmedUsage) setUsage(confirmedUsage)
      else void loadUsage()
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : 'The assistant could not answer right now. This request was not counted.'
      if (user) setMessages((current) => [...current, { id: makeId(), role: 'assistant', content: message, isError: true }])
    } finally {
      setLoading(false)
    }
  }

  const handleInputKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      void sendQuestion()
    }
  }

  const closeDrawer = () => {
    setOpen(false)
    setMenuOpen(false)
    onClose?.()
  }
  const dailyLimitReached = usage?.remaining === 0
  const usagePercent = usage?.limit ? Math.min(100, Math.max(0, (usage.used / usage.limit) * 100)) : 0

  return <div className={`ai-chat-root${open ? ' is-open' : ''}`}>
    <Drawer open={open} onOpenChange={(nextOpen) => { if (nextOpen) setOpen(true); else closeDrawer() }} side="right" ariaLabel="Ask AI assistant" className="ai-chat-panel">
      <div className="ai-chat-head">
        <div><p className="ai-chat-kicker">FINDMEAJOB / ASSISTANT</p><h2>Ask AI</h2><span className="ai-chat-model">GPT-5.6 Luna · secure account</span></div>
        <div className="ai-chat-actions" ref={menuRef}>
          <button className="ai-chat-icon" type="button" aria-label="Copy conversation" onClick={() => void copyConversation()}>⧉</button>
          <button className="ai-chat-icon" type="button" aria-label="Share conversation" onClick={() => void shareConversation()}>↥</button>
          <button className="ai-chat-icon" type="button" aria-label="Clear conversation" onClick={clearChat}>⌫</button>
          {user && <button className="ai-chat-icon" type="button" aria-label="Account and daily usage" aria-expanded={menuOpen} aria-haspopup="dialog" onClick={() => setMenuOpen((value) => !value)}>···</button>}
          <button className="ai-chat-icon ai-chat-close" type="button" aria-label="Close assistant" onClick={closeDrawer}>×</button>
          {user && menuOpen && <div className="ai-chat-settings ai-usage-menu" role="dialog" aria-label="Account and daily usage">
            <p className="ai-chat-settings-title">Daily usage</p>
            <p className="ai-usage-identity">{user.name || user.email}</p>
            <div className="ai-usage-count"><strong>{usage?.remaining ?? '—'}</strong><span>of {usage?.limit ?? DAILY_LIMIT} remaining</span></div>
            <div className="ai-usage-track" role="progressbar" aria-label="Questions used today" aria-valuemin={0} aria-valuemax={usage?.limit ?? DAILY_LIMIT} aria-valuenow={usage?.used ?? 0}><i style={{ width: `${usagePercent}%` }} /></div>
            <p className="ai-chat-settings-copy">{usageLoading ? 'Checking usage…' : `${usage?.used ?? 0} successful questions used · ${resetLabel(usage?.resetsAt)}`}</p>
            <p className="ai-usage-note">Failed requests and errors are not counted.</p>
            <button className="ai-chat-small-button ai-sign-out" type="button" onClick={() => void signOut()}>Sign out</button>
          </div>}
        </div>
      </div>

      {authLoading || !authChecked ? <div className="ai-auth-loading" role="status"><i /><span>Checking your session…</span></div> : !user ? <AuthGate /> : <>
        <div className="ai-chat-thread" ref={threadRef} aria-live="polite">
          {messages.length === 0 && <div className="ai-chat-empty"><p>Ask about roles, locations, experience, or which jobs fit your search.</p><div className="ai-chat-suggestions"><button type="button" onClick={() => setDraft('Which Findmeajob roles are remote?')}><span aria-hidden="true">△</span>Which roles are remote?</button><button type="button" onClick={() => setDraft('Which roles are best for a senior designer?')}><span aria-hidden="true">▣</span>Best roles for a senior designer?</button><button type="button" onClick={() => setDraft('Show me the newest design systems roles.')}><span aria-hidden="true">◈</span>Newest design systems roles</button><button type="button" onClick={() => setDraft('What Findmeajob jobs are available in New York?')}><span aria-hidden="true">▤</span>Roles in New York</button></div></div>}
          {messages.map((message) => <article className={`ai-chat-message is-${message.role}${message.isError ? ' is-error' : ''}`} key={message.id}><span className="ai-chat-message-label">{message.role === 'user' ? 'YOU' : message.isError ? 'NOT COUNTED' : 'AI'}</span>{message.role === 'assistant' ? <StreamingResponse text={message.content} onProgress={() => requestAnimationFrame(scrollToLatest)} /> : <p>{message.content}</p>}{message.sources && message.sources.length > 0 && <div className="ai-chat-sources">{message.matches && <p className="ai-chat-source-summary">{message.matches.truncated ? `Showing ${message.matches.shown} of ${message.matches.total} exact matches` : `${message.matches.total} exact ${message.matches.total === 1 ? 'match' : 'matches'}`}</p>}{message.sources.map((source, index) => { const details = [source.role, source.locations?.join(' / ') || source.location, displayMetadata(source.workMode), displayMetadata(source.employmentType)].filter(Boolean).join(' · '); return <a href={source.applyUrl || '#jobs'} key={`${source.id || source.company}-${index}`} target={source.applyUrl ? '_blank' : undefined} rel={source.applyUrl ? 'noreferrer' : undefined}><span>{source.company || 'Catalog role'}</span><small>{details || 'View role'}</small></a> })}</div>}</article>)}
          {loading && <div className="ai-chat-loading"><i /><i /><i /><span>Finding the best answer</span></div>}
        </div>
        <PromptInput draft={draft} setDraft={setDraft} onSubmit={sendQuestion} onKeyDown={handleInputKeyDown} inputRef={inputRef} loading={loading} disabled={dailyLimitReached} />
        <div className="ai-chat-foot"><span>{dailyLimitReached ? `${resetLabel(usage?.resetsAt)} · failed requests never count` : `${usage?.remaining ?? '—'} of ${usage?.limit ?? DAILY_LIMIT} questions remaining today`}</span>{messages.length > 0 && <button type="button" onClick={clearChat}>Clear</button>}</div>
      </>}
    </Drawer>
    {!open && showLauncher && <button className="ai-chat-launcher" type="button" onClick={() => setOpen(true)} aria-label="Open Ask AI assistant"><span className="ai-chat-launcher-mark" aria-hidden="true">✦</span><span>Ask AI</span></button>}
  </div>
}

export default AskAi
