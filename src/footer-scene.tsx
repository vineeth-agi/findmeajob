import type { CSSProperties } from 'react'
import './footer-scene.css'

const seekers = [
  { lane: 66, duration: 19, delay: -2, scale: 0.82 },
  { lane: 54, duration: 24, delay: -17, scale: 0.64 },
  { lane: 74, duration: 21, delay: -9, scale: 0.96 },
  { lane: 47, duration: 27, delay: -4, scale: 0.55 },
  { lane: 80, duration: 23, delay: -19, scale: 1.08 },
  { lane: 60, duration: 20, delay: -13, scale: 0.74 },
  { lane: 70, duration: 26, delay: -7, scale: 0.9 },
  { lane: 50, duration: 29, delay: -22, scale: 0.58 },
  { lane: 77, duration: 22, delay: -12, scale: 1.02 },
  { lane: 57, duration: 25, delay: -5, scale: 0.68 },
  { lane: 68, duration: 18, delay: -15, scale: 0.86 },
  { lane: 44, duration: 31, delay: -25, scale: 0.5 },
] as const

type SeekerStyle = CSSProperties & {
  '--lane': string
  '--duration': string
  '--delay': string
  '--scale': number
}

/** Lightweight, original footer art with no third-party runtime or image asset. */
export function FooterScene() {
  return <div className="fmj-footer-scene" aria-hidden="true">
    <div className="fmj-footer-wordmark">Findmeajob</div>
    <div className="fmj-seeker-field">
      {seekers.map((seeker, index) => <span
        className={`fmj-seeker${index % 2 ? ' is-reversed' : ''}`}
        key={`${seeker.lane}-${index}`}
        style={{
          '--lane': `${seeker.lane}%`,
          '--duration': `${seeker.duration}s`,
          '--delay': `${seeker.delay}s`,
          '--scale': seeker.scale,
        } as SeekerStyle}
      ><i /></span>)}
    </div>
  </div>
}
