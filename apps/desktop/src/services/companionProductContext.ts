import { trainingTimeSummary } from '@greekgod/analytics'
import { memoryStatus, type MemoryItem, type MemoryState } from '@greekgod/companion/memory'
import type { CompanionEvidence } from '@greekgod/companion/readonly'
import type { HumanCoachContext, HumanCoachItem } from '@greekgod/human-coach'
import type { AppData } from '../types.ts'
import { daysAgoIso, isoToday, parseDate } from '../utils/date.ts'
import { companionMemoryRepository } from './companionMemoryStorage.ts'
import { humanCoachRepository } from './humanCoachStorage.ts'

interface CompanionProductFact { readonly label: string; readonly text: string }
export interface CompanionProductContext {
  readonly evidence: readonly CompanionEvidence[]
  readonly evidenceDisplay: Readonly<Record<string, { readonly label: string; readonly text: string }>>
  readonly acceptedMemory: readonly string[]
}
export interface CompanionProductContextSources {
  readHumanCoach(): Promise<HumanCoachContext>
  readMemory(): Promise<MemoryState>
}

const defaultSources: CompanionProductContextSources = {
  readHumanCoach: () => humanCoachRepository.read(),
  readMemory: () => companionMemoryRepository.read(),
}
const normalized = (value: string) => value.normalize('NFKC').toLocaleLowerCase('pl-PL')
const asksAnalytics = (text: string) => /\b(trening|treningi|trenowa|czas|minut|sesj|aktywno)/u.test(normalized(text))
const asksCoach = (text: string) => /\b(trener|trenera|coach|zalec|ustalen|zadani|decyzj|cel)/u.test(normalized(text))
const asksMemory = (text: string) => /\b(pamię|zapamię|preferenc|podsumowa)/u.test(normalized(text))
const exerciseNames = (ids: readonly string[], data: AppData) => ids.flatMap((id) => {
  const matches = data.exerciseLibrary.filter((item) => item.id === id)
  return matches.length === 1 ? [matches[0].name] : []
})
const coachText = (item: HumanCoachItem, data: AppData) => {
  const names = item.kind === 'TASK' || item.kind === 'DECISION' ? exerciseNames(item.exerciseIds, data)
    : item.kind === 'TARGET' && item.specification.type === 'REP_RANGE' ? exerciseNames([item.specification.exerciseId], data) : []
  const suffix = names.length ? ` Ćwiczenia: ${names.join(', ')}.` : ''
  if (item.kind === 'NOTE') return `Zatwierdzona notatka trenera: ${item.text}`
  if (item.kind === 'TASK') return `Zatwierdzone zadanie trenera: ${item.title}. Status: ${item.status}.${item.description ? ` ${item.description}` : ''}${suffix}`
  if (item.kind === 'DECISION') return `Zatwierdzona decyzja trenera: ${item.text}${suffix}`
  const target = item.specification.type === 'REP_RANGE'
    ? `${item.specification.min}–${item.specification.max} powtórzeń`
    : `${item.specification.value} ${item.specification.unit}`
  return `Zatwierdzony cel trenera: ${item.title}. ${target}. Status: ${item.status}.${suffix}`
}
const memoryText = (item: MemoryItem) => item.content.kind === 'SUMMARY_STYLE'
  ? `Przyjęta preferencja odpowiedzi: ${item.content.value === 'SHORT' ? 'krótkie podsumowania' : 'szczegółowe podsumowania'}.`
  : 'Przyjęta pamięć wskazuje na zatwierdzony kontekst trenera.'

/** Read-only, request-scoped context. No writer or command capability crosses this boundary. */
export const buildCompanionProductContext = async (
  text: string,
  data: AppData,
  sources: CompanionProductContextSources = defaultSources,
  today = isoToday(),
  asOf = new Date().toISOString(),
): Promise<CompanionProductContext> => {
  const facts: CompanionProductFact[] = []
  const memoryState = asksMemory(text) ? await sources.readMemory() : undefined
  const acceptedMemory = (memoryState?.items ?? [])
    .filter((item) => item.scope.kind === 'GLOBAL' && memoryStatus(item, asOf) === 'ACTIVE')
    .slice(0, 10)
    .map(memoryText)
  if (asksAnalytics(text)) {
    const summary = trainingTimeSummary({ snapshot: data, from: daysAgoIso(29, parseDate(today)), to: today, asOf: today })
    facts.push({ label: 'Treningi z ostatnich 30 dni',
      text: `Ostatnie 30 dni — treningi: ${summary.recordedWorkoutCount}; z zapisanym czasem: ${summary.workoutsWithDuration}; łącznie: ${summary.totalDurationMinutes} min.` })
  }
  if (asksCoach(text)) {
    const context = await sources.readHumanCoach()
    context.items.filter((item) => item.acceptance.state === 'AUTHORITATIVE').slice(-10).forEach((item, index) => {
      facts.push({ label: `Kontekst trenera ${index + 1}`, text: coachText(item, data) })
    })
  }
  if (asksMemory(text)) acceptedMemory.forEach((value, index) => {
    facts.push({ label: `Przyjęta pamięć ${index + 1}`, text: value })
  })
  const presented = facts.map((fact, index) => ({ ...fact, id: `evidence-${index + 1}` }))
  return {
    evidence: presented.map(({ id, text }) => ({ id, text })),
    evidenceDisplay: Object.freeze(Object.fromEntries(presented.map(({ id, label, text }) => [id, Object.freeze({ label, text })]))),
    acceptedMemory: Object.freeze([...acceptedMemory]),
  }
}

/** Resolves only request-local opaque handles; persistence IDs never cross this UI boundary. */
export const resolveCompanionProductEvidence = (
  context: CompanionProductContext,
  handles: readonly string[],
): readonly { label: string; text: string }[] => handles.flatMap((handle) => {
  const display = context.evidenceDisplay[handle]
  return display ? [{ label: display.label, text: display.text }] : []
})
