import type { CompanionModel } from '../ports/companionModel.ts'
export { withCompanionMemory } from './context.ts'

export type MemoryScope = { kind: 'GLOBAL' } | { kind: 'EXERCISE' | 'HUMAN_COACH_CONTEXT'; id: string }
export type MemoryContent = { kind: 'SUMMARY_STYLE'; value: 'SHORT' | 'DETAILED' } | { kind: 'HUMAN_COACH_REFERENCE'; value: string }
export interface MemoryDraft { content: MemoryContent; scope: MemoryScope; expiresAt: string | null }
export interface MemoryItem extends MemoryDraft {
  id: string; source: 'USER_EXPLICIT' | 'HUMAN_COACH' | 'COMPANION_SUGGESTED'
  createdAt: string; provenance: { acceptedBy: 'USER'; sourceId: string | null }; status: 'ACTIVE' | 'ARCHIVED'
}
export interface MemoryState { version: 1; items: MemoryItem[] }
export interface MemoryReferences { exerciseIds: readonly string[]; coachItemIds: readonly string[] }
export interface MemoryRepository {
  read(): Promise<MemoryState>
  update(change: (current: MemoryState) => MemoryState | Promise<MemoryState>): Promise<MemoryState>
}
export interface CompanionMemoryReader {
  readActiveMemory(scope: MemoryScope, asOf: string): Promise<readonly MemoryItem[]>
}
export const MAX_MEMORY_ITEMS = 100
export const MAX_CONTEXT_MEMORY_ITEMS = 10

const record = (value: unknown, keys: string[]): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Object.getPrototypeOf(value) !== Object.prototype
    || Reflect.ownKeys(value).length !== keys.length || Reflect.ownKeys(value).some((key) => typeof key !== 'string'
      || !keys.includes(key) || !('value' in Object.getOwnPropertyDescriptor(value, key)!))) throw new Error('Invalid memory shape')
  return value as Record<string, unknown>
}
const id = (value: unknown): string => {
  if (typeof value !== 'string' || !value.trim() || value.trim() !== value || value.length > 256) throw new Error('Invalid memory reference')
  return value
}
export const memoryTimestamp = (value: unknown): string => {
  if (typeof value !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value)
    || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString() !== value) throw new Error('Invalid memory timestamp')
  return value
}
export const validateMemoryScope = (raw: unknown): MemoryScope => {
  const kind = raw && typeof raw === 'object' ? Object.getOwnPropertyDescriptor(raw, 'kind')?.value : undefined
  const value = record(raw, kind === 'GLOBAL' ? ['kind'] : ['kind', 'id'])
  if (kind === 'GLOBAL') return { kind }
  if (kind !== 'EXERCISE' && kind !== 'HUMAN_COACH_CONTEXT') throw new Error('Invalid memory scope')
  return { kind, id: id(value.id) }
}
export const validateMemoryDraft = (raw: unknown): MemoryDraft => {
  const value = record(raw, ['content', 'scope', 'expiresAt'])
  const content = record(value.content, ['kind', 'value'])
  if (content.kind !== 'SUMMARY_STYLE' && content.kind !== 'HUMAN_COACH_REFERENCE') throw new Error('Unsupported memory kind')
  if (content.kind === 'SUMMARY_STYLE' && content.value !== 'SHORT' && content.value !== 'DETAILED') throw new Error('Invalid summary style')
  const scope = validateMemoryScope(value.scope)
  const parsed = { kind: content.kind, value: id(content.value) } as MemoryContent
  if (parsed.kind === 'HUMAN_COACH_REFERENCE' && (scope.kind !== 'HUMAN_COACH_CONTEXT' || scope.id !== parsed.value)) throw new Error('HumanCoach reference/scope mismatch')
  if (parsed.kind === 'SUMMARY_STYLE' && scope.kind === 'HUMAN_COACH_CONTEXT') throw new Error('Preference scope mismatch')
  return { content: parsed, scope, expiresAt: value.expiresAt === null ? null : memoryTimestamp(value.expiresAt) }
}
export const validateMemoryState = (raw: unknown): MemoryState => {
  const state = record(raw, ['version', 'items'])
  if (state.version !== 1 || !Array.isArray(state.items) || state.items.length > MAX_MEMORY_ITEMS
    || Object.keys(state.items).length !== state.items.length) throw new Error('Unsupported or unbounded memory state')
  const items = state.items.map((rawItem) => {
    const item = record(rawItem, ['id', 'content', 'scope', 'expiresAt', 'source', 'createdAt', 'provenance', 'status'])
    const draft = validateMemoryDraft({ content: item.content, scope: item.scope, expiresAt: item.expiresAt })
    const provenance = record(item.provenance, ['acceptedBy', 'sourceId'])
    if (provenance.acceptedBy !== 'USER' || !['USER_EXPLICIT', 'HUMAN_COACH', 'COMPANION_SUGGESTED'].includes(item.source as string)
      || !['ACTIVE', 'ARCHIVED'].includes(item.status as string)) throw new Error('Unaccepted memory')
    const sourceId = provenance.sourceId === null ? null : id(provenance.sourceId)
    if ((draft.content.kind === 'HUMAN_COACH_REFERENCE') !== (item.source === 'HUMAN_COACH')
      || (item.source === 'HUMAN_COACH' && sourceId !== draft.content.value)
      || (item.source === 'USER_EXPLICIT' && sourceId !== null)
      || (item.source === 'COMPANION_SUGGESTED' && sourceId === null)) throw new Error('Invalid memory provenance')
    const createdAt = memoryTimestamp(item.createdAt)
    if (draft.expiresAt !== null && draft.expiresAt <= createdAt) throw new Error('Expiry must follow creation')
    return { ...draft, id: id(item.id), createdAt, source: item.source, status: item.status,
      provenance: { acceptedBy: 'USER', sourceId } } as MemoryItem
  })
  if (new Set(items.map((item) => item.id)).size !== items.length) throw new Error('Duplicate memory ID')
  return { version: 1, items }
}
const exact = (ids: readonly string[], target: string) => ids.filter((value) => value === target).length === 1
const validReference = (draft: MemoryDraft, refs: MemoryReferences) => draft.scope.kind === 'GLOBAL'
  || (draft.scope.kind === 'EXERCISE' ? exact(refs.exerciseIds, draft.scope.id) : exact(refs.coachItemIds, draft.scope.id))
export const memoryStatus = (item: MemoryItem, asOf: string): 'ACTIVE' | 'ARCHIVED' | 'EXPIRED' => {
  memoryTimestamp(asOf)
  return item.status === 'ARCHIVED' ? 'ARCHIVED' : item.expiresAt !== null && item.expiresAt <= asOf ? 'EXPIRED' : 'ACTIVE'
}
export const selectActiveMemory = (state: MemoryState, scope: MemoryScope, asOf: string, refs: MemoryReferences): MemoryItem[] => {
  const target = validateMemoryScope(scope); memoryTimestamp(asOf)
  return validateMemoryState(state).items.filter((item) => item.createdAt <= asOf && memoryStatus(item, asOf) === 'ACTIVE' && validReference(item, refs)
    && (item.scope.kind === 'GLOBAL' || (item.scope.kind === target.kind && 'id' in item.scope && 'id' in target && item.scope.id === target.id)))
    .sort((a, b) => a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
    .slice(0, MAX_CONTEXT_MEMORY_ITEMS)
}

export interface MemoryCandidate { readonly status: 'CANDIDATE'; readonly id: string; readonly draft: MemoryDraft }
export interface MemorySuggestionRequest { readonly kind: 'MEMORY_SUGGESTION'; readonly allowedStyles: readonly ['SHORT', 'DETAILED'] }
/** No persistence/review capability is supplied to the model. v1 suggestions are global preferences only. */
export const createMemoryCandidateReview = (newId: () => string) => {
  const candidates = new WeakMap<MemoryCandidate, MemoryDraft>()
  return {
    async propose(model: CompanionModel<MemorySuggestionRequest>): Promise<MemoryCandidate> {
      const draft = validateMemoryDraft(await model.propose({ kind: 'MEMORY_SUGGESTION', allowedStyles: ['SHORT', 'DETAILED'] }))
      if (draft.content.kind !== 'SUMMARY_STYLE' || draft.scope.kind !== 'GLOBAL') throw new Error('Unsupported suggestion scope/content')
      Object.freeze(draft.content); Object.freeze(draft.scope); Object.freeze(draft)
      const candidate = Object.freeze({ status: 'CANDIDATE' as const, id: id(newId()), draft })
      candidates.set(candidate, draft); return candidate
    },
    reject(candidate: MemoryCandidate) { candidates.delete(candidate) },
    consume(candidate: MemoryCandidate): MemoryDraft {
      const draft = candidates.get(candidate)
      if (!draft) throw new Error('Candidate missing, rejected or already reviewed')
      candidates.delete(candidate); return structuredClone(draft)
    },
  }
}
export const createMemoryApplication = (repository: MemoryRepository, readReferences: () => Promise<MemoryReferences>,
  clock: () => string, newId: () => string) => {
  const review = createMemoryCandidateReview(newId)
  const add = async (raw: MemoryDraft, candidateId?: string) => {
    const draft = validateMemoryDraft(raw)
    return repository.update(async (current) => {
      if (!validReference(draft, await readReferences())) throw new Error('Missing or ambiguous current entity')
      const createdAt = memoryTimestamp(clock())
      const source = draft.content.kind === 'HUMAN_COACH_REFERENCE' ? 'HUMAN_COACH' : candidateId ? 'COMPANION_SUGGESTED' : 'USER_EXPLICIT'
      const item: MemoryItem = { ...draft, id: id(newId()), source, createdAt, status: 'ACTIVE',
        provenance: { acceptedBy: 'USER', sourceId: source === 'HUMAN_COACH' ? draft.content.value : candidateId ?? null } }
      if (current.items.some((existing) => memoryStatus(existing, createdAt) === 'ACTIVE'
        && JSON.stringify(existing.content) === JSON.stringify(item.content) && JSON.stringify(existing.scope) === JSON.stringify(item.scope))) throw new Error('Equivalent active memory already exists')
      return validateMemoryState({ version: 1, items: [...current.items, item] })
    })
  }
  const reader: CompanionMemoryReader = { readActiveMemory: async (scope, asOf) => selectActiveMemory(await repository.read(), scope, asOf, await readReferences()) }
  return {
    reader,
    list: () => repository.read(),
    addExplicit: (draft: MemoryDraft) => add(draft),
    propose: review.propose,
    reject: review.reject,
    accept: (candidate: MemoryCandidate) => add(review.consume(candidate), candidate.id),
    archive: (memoryId: string) => repository.update((current) => {
      if (!current.items.some((item) => item.id === memoryId)) throw new Error('Unknown memory')
      return { version: 1, items: current.items.map((item) => item.id === memoryId ? { ...item, status: 'ARCHIVED' } : item) }
    }),
  }
}
