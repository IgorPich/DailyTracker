import { commandOutcomeReaction, createReactionCoordinator, readOnlyReaction, type ReactionSource } from '@greekgod/companion/reactions'

// Session-only presentation state. No store, command gateway, memory writer or event bus.
const coordinator = createReactionCoordinator()
const now = () => Math.floor(performance.now())
export const reactionSnapshot = (reducedMotion: boolean) => coordinator.snapshot(now(), reducedMotion)
export const observeReadOnlyReaction = (source: Exclude<ReactionSource, 'COMMAND_OUTCOME'>, status: 'MESSAGE' | 'INVALID') => {
  const time = now()
  return coordinator.submit(readOnlyReaction(source, status, { id: crypto.randomUUID(), createdAt: time, evidenceIds: [] }), time)
}
/** Never let optional presentation failure alter a confirmed persistence outcome. */
export const observeCommandReaction = (status: Parameters<typeof commandOutcomeReaction>[0]): void => {
  try {
    const time = now()
    coordinator.submit(commandOutcomeReaction(status, { id: crypto.randomUUID(), createdAt: time, evidenceIds: [] }), time)
  } catch { /* Presentation is best effort; no command retry and no mutation of its result. */ }
}
