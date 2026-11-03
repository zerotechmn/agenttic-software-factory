import type { AgentStatus, Role } from '../domain/types'
import { AGENTS, charArt } from '../realm/realm'

// The character art for a role. Motion is CSS-only, keyed off data-status (see .avatar in App.css),
// so prefers-reduced-motion switches it all off in one place. The orchestrator has no character:
// it is drawn as the FORGE seal.

function Seal() {
  return (
    <svg viewBox="0 0 64 64" width="100%" height="100%" aria-hidden="true">
      <circle cx="32" cy="32" r="29" fill="#2b2140" stroke="#ffc83d" strokeWidth="4" />
      <circle cx="32" cy="32" r="21" fill="none" stroke="#7c5cff" strokeWidth="3" strokeDasharray="4 3" />
      <path d="M22 40 L32 18 L42 40 Z" fill="#ffc83d" stroke="#8a5a00" strokeWidth="2" strokeLinejoin="round" />
      <rect x="20" y="40" width="24" height="6" rx="2" fill="#7c5cff" />
    </svg>
  )
}

export function Avatar({ role, status, size = 56 }: { role: Role; status: AgentStatus; size?: number | string }) {
  const src = charArt(AGENTS[role])
  return (
    <span className="avatar" data-status={status} style={{ width: size, height: size }} aria-hidden="true">
      <span className="bot">
        {src ? <img src={src} alt="" loading="lazy" decoding="async" /> : <Seal />}
      </span>
      {status === 'idle' && <span className="zzz">z</span>}
      {status === 'blocked' && <span className="bang">!</span>}
    </span>
  )
}
