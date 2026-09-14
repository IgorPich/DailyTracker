import type { CompanionModel } from '../ports/companionModel.ts'

export interface UserDialogueInput { readonly kind: 'USER_DIALOGUE'; readonly text: string }
export interface SpontaneousCompanionTrigger { readonly kind: 'SPONTANEOUS_COMPANION'; readonly reason: 'CONTEXT_AVAILABLE' }
export interface ApplicationEventTrigger { readonly kind: 'APPLICATION_EVENT'; readonly event: 'WORKOUT_SAVED' | 'TRAINER_CONTEXT_UPDATED' }
const dialogues = new WeakSet<object>()
const spontaneous = new WeakSet<object>()
const events = new WeakSet<object>()
export const userDialogueInput = (text: string): UserDialogueInput => {
  if (typeof text !== 'string' || !text.trim()) throw new Error('Dialogue text required')
  const input = Object.freeze({ kind: 'USER_DIALOGUE' as const, text })
  dialogues.add(input); return input
}
export const spontaneousCompanionTrigger = (): SpontaneousCompanionTrigger => {
  const input = Object.freeze({ kind: 'SPONTANEOUS_COMPANION' as const, reason: 'CONTEXT_AVAILABLE' as const })
  spontaneous.add(input); return input
}
export const applicationEventTrigger = (event: ApplicationEventTrigger['event']): ApplicationEventTrigger => {
  if (event !== 'WORKOUT_SAVED' && event !== 'TRAINER_CONTEXT_UPDATED') throw new Error('Unsupported event')
  const input = Object.freeze({ kind: 'APPLICATION_EVENT' as const, event })
  events.add(input); return input
}

/** Already-calculated facts or explicitly provided trainer context; never raw aggregates. */
export interface CompanionEvidence { readonly id: string; readonly text: string }
export interface CompanionContextReader { readEvidence(): Promise<readonly CompanionEvidence[]> }
export interface CompanionReadOnlyRequest {
  readonly kind: 'COMPANION_READ_ONLY'
  readonly input: UserDialogueInput | SpontaneousCompanionTrigger | ApplicationEventTrigger
  readonly evidence: readonly CompanionEvidence[]
}
export interface CompanionReadOnlyResponse { readonly message: string; readonly evidenceIds: readonly string[] }
export type ReadOnlyResult = { status: 'MESSAGE'; response: CompanionReadOnlyResponse } | { status: 'INVALID'; message: string }

const closedObject = (value: unknown, keys: readonly string[]): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Object.getPrototypeOf(value) !== Object.prototype
    || Reflect.ownKeys(value).length !== keys.length
    || Reflect.ownKeys(value).some((key) => typeof key !== 'string' || !keys.includes(key)
      || !('value' in Object.getOwnPropertyDescriptor(value, key)!))) throw new Error('Invalid closed response/context object')
  return value as Record<string, unknown>
}
const denseArray = (value: unknown): unknown[] => {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype
    || Reflect.ownKeys(value).length !== value.length + 1
    || Reflect.ownKeys(value).some((key) => key !== 'length' && (typeof key !== 'string'
      || !/^(0|[1-9]\d*)$/.test(key) || Number(key) >= value.length
      || !('value' in Object.getOwnPropertyDescriptor(value, key)!)))) throw new Error('Invalid array')
  return value
}
const evidenceSnapshot = (raw: unknown): CompanionEvidence[] => {
  const evidence = denseArray(raw).map((item) => {
    const { id, text } = closedObject(item, ['id', 'text'])
    if (typeof id !== 'string' || !id.trim() || id.trim() !== id || typeof text !== 'string' || !text.trim()) throw new Error('Invalid evidence')
    return { id, text }
  })
  if (new Set(evidence.map((item) => item.id)).size !== evidence.length) throw new Error('Ambiguous evidence IDs')
  return evidence
}
const validateResponse = (raw: unknown, evidence: readonly CompanionEvidence[]): CompanionReadOnlyResponse => {
  const { message, evidenceIds } = closedObject(raw, ['message', 'evidenceIds'])
  if (typeof message !== 'string' || !message.trim()) throw new Error('Message required')
  const refs = denseArray(evidenceIds)
  if (new Set(refs).size !== refs.length || refs.some((id) => typeof id !== 'string' || !evidence.some((item) => item.id === id))) throw new Error('Unknown or duplicate evidence reference')
  return Object.freeze({ message, evidenceIds: Object.freeze(refs as string[]) })
}

/** Only a reader and an untrusted text provider: no executor, store or mutable domain service. */
export const createReadOnlyCompanion = (reader: CompanionContextReader, model: CompanionModel<CompanionReadOnlyRequest>) => {
  const process = async (input: CompanionReadOnlyRequest['input'], issued: WeakSet<object>): Promise<ReadOnlyResult> => {
    if (!issued.has(input)) return { status: 'INVALID', message: 'Correctly issued read-only input required' }
    issued.delete(input)
    try {
      const evidence = evidenceSnapshot(await reader.readEvidence())
      const request: CompanionReadOnlyRequest = { kind: 'COMPANION_READ_ONLY', input: structuredClone(input), evidence: structuredClone(evidence) }
      return { status: 'MESSAGE', response: validateResponse(await model.propose(request), evidence) }
    } catch { return { status: 'INVALID', message: 'Read-only context or response unavailable/invalid' } }
  }
  return Object.freeze({
    dialogue: (input: UserDialogueInput) => process(input, dialogues),
    spontaneous: (input: SpontaneousCompanionTrigger) => process(input, spontaneous),
    applicationEvent: (input: ApplicationEventTrigger) => process(input, events),
  })
}
