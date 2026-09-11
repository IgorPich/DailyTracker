import {
  linkedExerciseIds, requireTimestamp, validateHumanCoachContext,
  type HumanCoachContext, type HumanCoachItem, type CoachNote, type CoachTask,
  type CoachTarget, type CoachDecision, type Provenance, type TargetSpecification, type CoachTaskStatus,
} from '../domain/context.ts'
import type { ExerciseReferences, HumanCoachRepository } from '../ports/contextRepository.ts'

export interface CreateCoachItemCommand { id: string; provenance: Provenance }
export interface CreateCoachNoteCommand extends CreateCoachItemCommand { text: string }
export interface CreateCoachTaskCommand extends CreateCoachItemCommand { title: string; description?: string; exerciseIds: readonly string[] }
export interface CreateCoachTargetCommand extends CreateCoachItemCommand { title: string; specification: TargetSpecification }
export interface CreateCoachDecisionCommand extends CreateCoachItemCommand { text: string; exerciseIds: readonly string[] }
export interface AcceptCoachItemCommand { id: string; acceptedAt: string }
export interface UpdateCoachTaskStatusCommand { id: string; status: CoachTaskStatus; changedAt: string; note?: string }
export interface RetireCoachTargetCommand { id: string; retiredAt: string }

export const createHumanCoach = (repository: HumanCoachRepository, exercises: ExerciseReferences) => {
  const checkLinks = (item: HumanCoachItem) => {
    const known = exercises.readExerciseIds()
    for (const id of linkedExerciseIds(item)) {
      if (known.filter((candidate) => candidate === id).length !== 1) throw new Error(`Unknown or ambiguous exercise ID: ${id}`)
    }
  }
  const base = (command: CreateCoachItemCommand) => ({
    id: command.id, createdAt: command.provenance.createdAt,
    provenance: structuredClone(command.provenance), acceptance: { state: 'DRAFT' as const },
  })
  const add = (item: HumanCoachItem) => repository.update((context) => {
    checkLinks(item)
    const next = { ...context, items: [...context.items, item] }
    validateHumanCoachContext(next)
    return next
  })
  const change = (id: string, update: (item: HumanCoachItem) => HumanCoachItem) => repository.update((context) => {
    if (!context.items.some((item) => item.id === id)) throw new Error('Unknown HumanCoach item')
    const next = { ...context, items: context.items.map((item) => item.id === id ? update(item) : item) }
    validateHumanCoachContext(next)
    return next
  })
  return {
    listContext: (): Promise<HumanCoachContext> => repository.read(),
    listCoachNotes: async () => (await repository.read()).items.filter((item): item is CoachNote => item.kind === 'NOTE'),
    listAuthoritativeContext: async () => ({ version: 1 as const, items: (await repository.read()).items.filter((item) => item.acceptance.state === 'AUTHORITATIVE') }),
    createCoachNote: (command: CreateCoachNoteCommand) => add({ ...base(command), kind: 'NOTE', text: command.text } satisfies CoachNote),
    createCoachTask: (command: CreateCoachTaskCommand) => add({ ...base(command), kind: 'TASK', title: command.title, description: command.description,
      exerciseIds: [...command.exerciseIds], status: 'OPEN', statusHistory: [] } satisfies CoachTask),
    createCoachTarget: (command: CreateCoachTargetCommand) => add({ ...base(command), kind: 'TARGET', title: command.title,
      specification: structuredClone(command.specification), status: 'ACTIVE' } satisfies CoachTarget),
    createCoachDecision: (command: CreateCoachDecisionCommand) => add({ ...base(command), kind: 'DECISION', text: command.text, exerciseIds: [...command.exerciseIds] } satisfies CoachDecision),
    acceptCoachItem: (command: AcceptCoachItemCommand) => change(command.id, (item) => {
      if (item.acceptance.state !== 'DRAFT') throw new Error('Item is already authoritative')
      checkLinks(item)
      requireTimestamp(command.acceptedAt)
      return { ...item, acceptance: { state: 'AUTHORITATIVE', acceptedAt: command.acceptedAt } }
    }),
    updateCoachTaskStatus: (command: UpdateCoachTaskStatusCommand) => change(command.id, (item) => {
      if (item.kind !== 'TASK' || item.acceptance.state !== 'AUTHORITATIVE') throw new Error('Only accepted tasks can change status')
      return { ...item, status: command.status, statusHistory: [...item.statusHistory, { status: command.status, changedAt: command.changedAt, note: command.note }] }
    }),
    retireCoachTarget: (command: RetireCoachTargetCommand) => change(command.id, (item) => {
      if (item.kind !== 'TARGET' || item.acceptance.state !== 'AUTHORITATIVE' || item.status !== 'ACTIVE') throw new Error('Only active accepted targets can be retired')
      return { ...item, status: 'RETIRED', retiredAt: command.retiredAt }
    }),
  }
}
