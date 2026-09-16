import type { AvatarPresentationState, SemanticReaction } from '@greekgod/companion/reactions'

const presentation: Record<SemanticReaction, { symbol: string; label: string }> = {
  NEUTRAL: { symbol: 'G', label: 'Companion jest gotowy' },
  ACKNOWLEDGE: { symbol: '✓', label: 'Companion odpowiedział' },
  POSITIVE: { symbol: '+', label: 'Zmiana została potwierdzona' },
  CONCERNED: { symbol: '!', label: 'Companion wymaga uwagi' },
}

/** The only UI mapping from closed semantic state to local presentation. */
export function AvatarPresenter({ state }: { state: AvatarPresentationState }) {
  const current = presentation[state.semanticReaction]
  return <div className={`avatar-presenter${state.reducedMotion ? ' avatar-presenter--reduced' : ''}`}
    data-semantic-reaction={state.semanticReaction} role="img" aria-label={current.label}>
    <span aria-hidden="true">{current.symbol}</span>
    <small>{current.label}</small>
  </div>
}
