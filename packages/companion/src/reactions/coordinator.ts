export const SEMANTIC_REACTIONS = Object.freeze(['NEUTRAL', 'ACKNOWLEDGE', 'POSITIVE', 'CONCERNED'] as const)
export type SemanticReaction = typeof SEMANTIC_REACTIONS[number]
export type ReactionPriority = 'LOW' | 'NORMAL' | 'HIGH'
export type ReactionSource = 'USER_DIALOGUE' | 'SPONTANEOUS' | 'APPLICATION_EVENT' | 'COMMAND_OUTCOME'
export interface ReactionRequest {
  id: string; semanticReaction: SemanticReaction; source: ReactionSource
  priority: ReactionPriority; createdAt: number; evidenceIds: readonly string[]
}
export interface AvatarPresentationState {
  semanticReaction: SemanticReaction; token: string | null; startedAt: number | null
  reducedMotion: boolean
}
export const REACTION_POLICY_V1 = Object.freeze({ version: 1, lifetimeMs: 3_000, cooldownMs: 8_000, queueExpiryMs: 10_000, maxQueued: 8 })
const rank: Record<ReactionPriority, number> = { LOW: 0, NORMAL: 1, HIGH: 2 }
const time = (value: unknown): number => {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) throw new Error('Invalid reaction time')
  return value
}
const identifier = (value: unknown): value is string => typeof value === 'string' && value.trim() === value && value.length > 0 && value.length <= 256
const key = (request: ReactionRequest) => `${request.semanticReaction}:${request.priority}`
const validate = (raw: ReactionRequest): ReactionRequest => {
  const keys = ['id', 'semanticReaction', 'source', 'priority', 'createdAt', 'evidenceIds']
  if (!raw || Object.getPrototypeOf(raw) !== Object.prototype || Reflect.ownKeys(raw).length !== keys.length
    || Reflect.ownKeys(raw).some((field) => typeof field !== 'string' || !keys.includes(field)
      || !('value' in Object.getOwnPropertyDescriptor(raw, field)!))) throw new Error('Invalid reaction request shape')
  if (!identifier(raw.id) || !SEMANTIC_REACTIONS.includes(raw.semanticReaction)
    || !['LOW', 'NORMAL', 'HIGH'].includes(raw.priority)
    || !['USER_DIALOGUE', 'SPONTANEOUS', 'APPLICATION_EVENT', 'COMMAND_OUTCOME'].includes(raw.source)) throw new Error('Unknown reaction/source/priority')
  time(raw.createdAt)
  if (!Array.isArray(raw.evidenceIds) || raw.evidenceIds.length > 16 || Object.getPrototypeOf(raw.evidenceIds) !== Array.prototype
    || Reflect.ownKeys(raw.evidenceIds).length !== raw.evidenceIds.length + 1
    || Reflect.ownKeys(raw.evidenceIds).some((field) => field !== 'length' && (typeof field !== 'string'
      || !/^(0|[1-9]\d*)$/.test(field) || Number(field) >= raw.evidenceIds.length
      || !('value' in Object.getOwnPropertyDescriptor(raw.evidenceIds, field)!)))
    || raw.evidenceIds.some((id) => !identifier(id)) || new Set(raw.evidenceIds).size !== raw.evidenceIds.length) throw new Error('Invalid evidence references')
  return structuredClone(raw)
}

/** Pure in-memory presentation arbitration. The caller supplies time; no model, I/O or domain services. */
export const createReactionCoordinator = () => {
  let lastTime = 0
  let current: { request: ReactionRequest; startedAt: number } | undefined
  let queue: ReactionRequest[] = []
  const lastShown = new Map<string, number>() // closed enum × priority: bounded
  let suppressedCount = 0, expiredCount = 0
  const cooling = (request: ReactionRequest, now: number) => {
    const shown = lastShown.get(key(request))
    return shown !== undefined && now - shown < REACTION_POLICY_V1.cooldownMs
  }
  const show = (request: ReactionRequest, now: number) => { current = { request, startedAt: now }; lastShown.set(key(request), now) }
  const order = (a: ReactionRequest, b: ReactionRequest) => rank[b.priority] - rank[a.priority]
    || a.createdAt - b.createdAt || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
  const advance = (now: number) => {
    time(now); if (now < lastTime) throw new Error('Reaction time must be monotonic')
    lastTime = now
    const live = queue.filter((request) => now - request.createdAt < REACTION_POLICY_V1.queueExpiryMs)
    expiredCount += queue.length - live.length; queue = live
    if (current && now - current.startedAt >= REACTION_POLICY_V1.lifetimeMs) current = undefined
    if (!current) {
      queue.sort(order)
      const next = queue.findIndex((request) => !cooling(request, now))
      if (next >= 0) show(queue.splice(next, 1)[0], now)
    }
  }
  return {
    submit(raw: ReactionRequest, now: number): 'DISPLAYED' | 'QUEUED' | 'SUPPRESSED' | 'DROPPED' {
      const request = validate(raw)
      time(now)
      if (request.createdAt > now) throw new Error('Future reaction request')
      advance(now)
      if (now - request.createdAt >= REACTION_POLICY_V1.queueExpiryMs) { expiredCount++; return 'DROPPED' }
      if (request.semanticReaction === 'NEUTRAL' || cooling(request, now) || current?.request.id === request.id
        || queue.some((item) => item.id === request.id || key(item) === key(request))) { suppressedCount++; return 'SUPPRESSED' }
      if (!current || rank[request.priority] > rank[current.request.priority]) {
        // Preempted presentation is discarded, not replayed later as a stale reaction.
        show(request, now); return 'DISPLAYED'
      }
      queue.push(request); queue.sort(order)
      if (queue.length > REACTION_POLICY_V1.maxQueued) {
        const removed = queue.pop()!
        if (removed.id === request.id) return 'DROPPED'
      }
      return 'QUEUED'
    },
    snapshot(now: number, reducedMotion: boolean) {
      if (typeof reducedMotion !== 'boolean') throw new Error('Reduced motion must be explicit')
      advance(now)
      const presentation: AvatarPresentationState = { semanticReaction: current?.request.semanticReaction ?? 'NEUTRAL',
        token: current?.request.id ?? null, startedAt: current?.startedAt ?? null, reducedMotion }
      return { presentation, queuedCount: queue.length, suppressedCount, expiredCount, policyVersion: REACTION_POLICY_V1.version }
    },
  }
}

export interface ReactionMetadata { id: string; createdAt: number; evidenceIds: readonly string[] }
/** Application policy only. Read-only/model schemas remain unchanged. */
export const readOnlyReaction = (source: Exclude<ReactionSource, 'COMMAND_OUTCOME'>, status: 'MESSAGE' | 'INVALID', metadata: ReactionMetadata): ReactionRequest => {
  if (!['USER_DIALOGUE', 'SPONTANEOUS', 'APPLICATION_EVENT'].includes(source) || !['MESSAGE', 'INVALID'].includes(status)) throw new Error('Unknown read-only outcome')
  return validate({ ...metadata, source, semanticReaction: status === 'MESSAGE' ? 'ACKNOWLEDGE' : 'CONCERNED',
    priority: source === 'APPLICATION_EVENT' ? 'NORMAL' : 'LOW' })
}
export const commandOutcomeReaction = (status: 'APPLIED' | 'FAILED' | 'STALE' | 'INDETERMINATE' | 'BLOCKED', metadata: ReactionMetadata): ReactionRequest => {
  if (!['APPLIED', 'FAILED', 'STALE', 'INDETERMINATE', 'BLOCKED'].includes(status)) throw new Error('Unknown command outcome')
  return validate({ ...metadata, source: 'COMMAND_OUTCOME', semanticReaction: status === 'APPLIED' ? 'POSITIVE' : 'CONCERNED',
    priority: status === 'APPLIED' ? 'NORMAL' : 'HIGH' })
}
