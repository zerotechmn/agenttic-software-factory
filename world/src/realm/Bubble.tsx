import { bubbleArt } from './realm'
import type { BubbleKind } from './visuals'

/** A speech bubble drawn with the FORGE bubble art; text is clamped to two lines. */
export function Bubble({ kind, text, className = '' }: { kind: BubbleKind; text: string; className?: string }) {
  return (
    <span className={`bubble b-${kind} ${className}`} style={{ backgroundImage: `url(${bubbleArt(kind)})` }}>
      <span className="bubble-text">{text}</span>
    </span>
  )
}
