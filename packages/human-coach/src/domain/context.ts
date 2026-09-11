export interface Provenance {
  readonly sourceType: 'MANUAL' | 'TRAINER_TEXT'
  readonly createdAt: string
  readonly sourceNoteId?: string
  readonly sourceReference?: string
}

export type Acceptance =
  | { readonly state: 'DRAFT' }
  | { readonly state: 'AUTHORITATIVE'; readonly acceptedAt: string }

interface CoachItem {
  readonly id: string
  readonly createdAt: string
  readonly provenance: Provenance
  readonly acceptance: Acceptance
}

export interface CoachNote extends CoachItem {
  readonly kind: 'NOTE'
  readonly text: string
}

export type CoachTaskStatus = 'OPEN' | 'COMPLETED' | 'CANCELLED'
export interface TaskStatusChange {
  readonly status: CoachTaskStatus
  readonly changedAt: string
  readonly note?: string
}
export interface CoachTask extends CoachItem {
  readonly kind: 'TASK'
  readonly title: string
  readonly description?: string
  readonly exerciseIds: readonly string[]
  readonly status: CoachTaskStatus
  readonly statusHistory: readonly TaskStatusChange[]
}

export type TargetSpecification =
  | { readonly type: 'BODYWEIGHT'; readonly scope: 'PERSON'; readonly value: number; readonly unit: 'kg' }
  | { readonly type: 'WAIST'; readonly scope: 'PERSON'; readonly value: number; readonly unit: 'cm' }
  | { readonly type: 'REP_RANGE'; readonly scope: 'EXERCISE'; readonly exerciseId: string; readonly min: number; readonly max: number; readonly unit: 'reps' }

export interface CoachTarget extends CoachItem {
  readonly kind: 'TARGET'
  readonly title: string
  readonly specification: TargetSpecification
  readonly status: 'ACTIVE' | 'RETIRED'
  readonly retiredAt?: string
}

export interface CoachDecision extends CoachItem {
  readonly kind: 'DECISION'
  readonly text: string
  readonly exerciseIds: readonly string[]
}

export type HumanCoachItem = CoachNote | CoachTask | CoachTarget | CoachDecision
export interface HumanCoachContext {
  readonly version: 1
  readonly items: readonly HumanCoachItem[]
}
export const emptyHumanCoachContext = (): HumanCoachContext => ({ version: 1, items: [] })
export const linkedExerciseIds = (item: HumanCoachItem): readonly string[] => {
  if (item.kind === 'TASK' || item.kind === 'DECISION') return item.exerciseIds
  if (item.kind === 'TARGET' && item.specification.type === 'REP_RANGE') return [item.specification.exerciseId]
  return []
}

export function requireText(value: unknown): asserts value is string {
  if (typeof value !== 'string' || !value.trim()) throw new Error('Expected non-empty text')
}
export function requireTimestamp(value: unknown): asserts value is string {
  requireText(value)
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString() !== value) {
    throw new Error('Expected canonical UTC timestamp')
  }
}
const optionalText = (value: unknown) => { if (value !== undefined) requireText(value) }
const object = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid HumanCoach object')
  return value as Record<string, unknown>
}
const status = (value: unknown) => {
  if (!['OPEN', 'COMPLETED', 'CANCELLED'].includes(value as string)) throw new Error('Invalid task status')
}

// Fail closed on corrupt/unsupported local data. Never normalize or repair source text.
export function validateHumanCoachContext(value: unknown): asserts value is HumanCoachContext {
  const root = object(value)
  if (root.version !== 1 || !Array.isArray(root.items)) throw new Error('Unsupported HumanCoach data')
  const ids = new Set<string>()
  for (const raw of root.items) {
    const item = object(raw)
    requireText(item.id)
    if (ids.has(item.id)) throw new Error('Duplicate HumanCoach ID')
    ids.add(item.id)
    requireTimestamp(item.createdAt)
    const provenance = object(item.provenance)
    if (!['MANUAL', 'TRAINER_TEXT'].includes(provenance.sourceType as string)) throw new Error('Invalid provenance')
    if (provenance.createdAt !== item.createdAt) throw new Error('Provenance timestamp mismatch')
    optionalText(provenance.sourceReference)
    optionalText(provenance.sourceNoteId)
    const acceptance = object(item.acceptance)
    if (acceptance.state === 'AUTHORITATIVE') {
      requireTimestamp(acceptance.acceptedAt)
      if (acceptance.acceptedAt < item.createdAt) throw new Error('Acceptance predates creation')
    } else if (acceptance.state !== 'DRAFT' || acceptance.acceptedAt !== undefined) throw new Error('Invalid acceptance')
    switch (item.kind) {
      case 'NOTE':
        requireText(item.text)
        if (provenance.sourceNoteId !== undefined) throw new Error('Source notes cannot derive from another note in v1')
        break
      case 'TASK': {
        requireText(item.title)
        optionalText(item.description)
        status(item.status)
        if (!Array.isArray(item.statusHistory)) throw new Error('Invalid task history')
        let previousTime = item.createdAt
        let previousStatus = 'OPEN'
        for (const rawChange of item.statusHistory) {
          const change = object(rawChange)
          status(change.status)
          requireTimestamp(change.changedAt)
          optionalText(change.note)
          if (acceptance.state !== 'AUTHORITATIVE' || change.changedAt < (acceptance.acceptedAt as string) || change.changedAt < previousTime || change.status === previousStatus) throw new Error('Invalid status transition')
          previousTime = change.changedAt
          previousStatus = change.status as string
        }
        if (item.status !== previousStatus) throw new Error('Task status/history mismatch')
        break
      }
      case 'TARGET': {
        requireText(item.title)
        const target = object(item.specification)
        if (target.type === 'REP_RANGE') {
          requireText(target.exerciseId)
          if (target.scope !== 'EXERCISE' || target.unit !== 'reps' || !Number.isInteger(target.min) || !Number.isInteger(target.max) || (target.min as number) < 1 || (target.max as number) < (target.min as number)) throw new Error('Invalid rep range')
        } else if (target.type === 'BODYWEIGHT' || target.type === 'WAIST') {
          if (target.scope !== 'PERSON' || target.unit !== (target.type === 'BODYWEIGHT' ? 'kg' : 'cm') || typeof target.value !== 'number' || !Number.isFinite(target.value) || target.value <= 0) throw new Error('Invalid measurement target')
        } else throw new Error('Unsupported target type')
        if (item.status === 'RETIRED') {
          requireTimestamp(item.retiredAt)
          if (acceptance.state !== 'AUTHORITATIVE' || item.retiredAt < (acceptance.acceptedAt as string)) throw new Error('Invalid target retirement')
        } else if (item.status !== 'ACTIVE' || item.retiredAt !== undefined) throw new Error('Invalid target status')
        break
      }
      case 'DECISION': requireText(item.text); break
      default: throw new Error('Unknown HumanCoach item kind')
    }
    if (item.kind === 'TASK' || item.kind === 'DECISION') {
      if (!Array.isArray(item.exerciseIds)) throw new Error('Invalid exercise links')
      item.exerciseIds.forEach(requireText)
      if (new Set(item.exerciseIds).size !== item.exerciseIds.length) throw new Error('Duplicate exercise links')
    }
    if (item.kind !== 'NOTE' && provenance.sourceType === 'TRAINER_TEXT' && !provenance.sourceNoteId) throw new Error('Trainer-derived context requires a source note')
  }
  for (const raw of root.items) {
    const item = raw as HumanCoachItem
    if (item.provenance.sourceNoteId) {
      const source = root.items.find((candidate: HumanCoachItem) => candidate.id === item.provenance.sourceNoteId)
      if (!source || source.kind !== 'NOTE' || source.createdAt > item.createdAt) throw new Error('Invalid source note link')
    }
  }
}
