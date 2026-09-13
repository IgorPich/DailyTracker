import type { ProposedDraftFields } from '../extraction/proposal.ts'

const fail = (): never => { throw new Error('Invalid Companion proposal response') }
const array = (value: unknown, limit: number): unknown[] => {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype || value.length > limit) return fail()
  const keys = Reflect.ownKeys(value)
  if (keys.length !== value.length + 1 || keys.some((key) => key !== 'length'
    && (typeof key !== 'string' || !/^(0|[1-9]\d*)$/.test(key) || Number(key) >= value.length
      || !('value' in Object.getOwnPropertyDescriptor(value, key)!)))) return fail()
  return value
}
const object = (value: unknown, required: string[], optional: string[] = []): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) return fail()
  const keys = Reflect.ownKeys(value)
  if (keys.some((key) => typeof key !== 'string' || ![...required, ...optional].includes(key))
    || required.some((key) => !Object.prototype.hasOwnProperty.call(value, key))) return fail()
  // A provider must return data, not getters with side effects.
  if (keys.some((key) => !('value' in Object.getOwnPropertyDescriptor(value, key)!))) return fail()
  return value as Record<string, unknown>
}
const text = (value: unknown) => {
  if (typeof value !== 'string' || !value.trim() || value.length > 20000) fail()
}
const positive = (value: unknown) => { if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) fail() }
const link = (value: unknown, allowed: ReadonlySet<string>) => {
  if (typeof value !== 'string' || !allowed.has(value)) fail()
}

/** Whole-response rejection. No coercion, unknown-field stripping, ID repair or partial success. */
export const validateModelOutput = (raw: unknown, allowed: ReadonlySet<string>): ProposedDraftFields[] => {
  const response = array(raw, 20)
  for (const value of response) {
    // Inspect kind through a data descriptor, before reading other properties.
    const kind = value && typeof value === 'object' ? Object.getOwnPropertyDescriptor(value, 'kind')?.value : undefined
    if (kind === 'TASK' || kind === 'DECISION') {
      const item = kind === 'TASK' ? object(value, ['kind', 'title', 'exerciseIds'], ['description']) : object(value, ['kind', 'text', 'exerciseIds'])
      text(kind === 'TASK' ? item.title : item.text)
      if (Object.prototype.hasOwnProperty.call(item, 'description')) text(item.description)
      for (const id of array(item.exerciseIds, 1)) link(id, allowed)
    } else if (kind === 'TARGET') {
      const item = object(value, ['kind', 'title', 'specification'])
      text(item.title)
      const targetKind = item.specification && typeof item.specification === 'object'
        ? Object.getOwnPropertyDescriptor(item.specification, 'type')?.value : undefined
      if (targetKind === 'REP_RANGE') {
        const target = object(item.specification, ['type', 'scope', 'exerciseId', 'min', 'max', 'unit'])
        if (target.scope !== 'EXERCISE' || target.unit !== 'reps' || !Number.isInteger(target.min)
          || !Number.isInteger(target.max) || (target.min as number) < 1 || (target.max as number) < (target.min as number)) fail()
        if (target.exerciseId !== null) link(target.exerciseId, allowed)
      } else if (targetKind === 'BODYWEIGHT' || targetKind === 'WAIST') {
        const target = object(item.specification, ['type', 'scope', 'value', 'unit'])
        if (target.scope !== 'PERSON' || target.unit !== (targetKind === 'BODYWEIGHT' ? 'kg' : 'cm')) fail()
        positive(target.value)
      } else fail()
    } else fail()
  }
  return structuredClone(response) as ProposedDraftFields[]
}
