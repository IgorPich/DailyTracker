import { prepareTemplateRepRange, type AppData, type TemplateRepRangePlan } from '@greekgod/core'
import type { CompanionModel } from '../ports/companionModel.ts'

export type CommandSnapshot = Pick<AppData, 'templates' | 'exerciseLibrary'>
export interface CommandCandidate {
  reference: string; templateId: string; templateExerciseId: string; exerciseId: string
  templateName: string; exerciseName: string; prescription: string
}
export interface CommandModelRequest { text: string; candidates: readonly CommandCandidate[] }
export interface ExplicitUserCommandInput { readonly kind: 'EXPLICIT_USER_COMMAND'; readonly text: string }
const explicitInputs = new WeakSet<object>()
/** Only the explicit submit handler should issue this envelope. Notes are not interchangeable with it. */
export const explicitUserCommandInput = (text: string): ExplicitUserCommandInput => {
  if (!text.trim()) throw new Error('Empty explicit command')
  const input = Object.freeze({ kind: 'EXPLICIT_USER_COMMAND' as const, text })
  explicitInputs.add(input); return input
}

export const commandCandidates = (snapshot: CommandSnapshot): CommandCandidate[] => snapshot.templates.flatMap((template) => {
  if (snapshot.templates.filter((item) => item.id === template.id).length !== 1) return []
  return template.exercises.flatMap((row) => {
    if (!row.exerciseId || row.exerciseId.trim() !== row.exerciseId || !row.exerciseId.trim()
      || snapshot.exerciseLibrary.filter((item) => item.id === row.exerciseId).length !== 1
      || template.exercises.filter((item) => item.id === row.id).length !== 1) return []
    return [{ reference: JSON.stringify([template.id, row.id, row.exerciseId]), templateId: template.id,
      templateExerciseId: row.id, exerciseId: row.exerciseId, templateName: template.name, exerciseName: row.name, prescription: row.prescription }]
  })
})

interface ModelAction { action: 'CHANGE_TEMPLATE_REP_RANGE'; candidateRefs: string[]; minReps: number; maxReps: number }
const validate = (raw: unknown, candidates: readonly CommandCandidate[]): ModelAction => {
  if (!raw || typeof raw !== 'object' || Object.getPrototypeOf(raw) !== Object.prototype) throw new Error('Invalid command output')
  const keys = ['action', 'candidateRefs', 'minReps', 'maxReps']
  if (Reflect.ownKeys(raw).length !== keys.length || Reflect.ownKeys(raw).some((key) => typeof key !== 'string' || !keys.includes(key)
    || !('value' in Object.getOwnPropertyDescriptor(raw, key)!))) throw new Error('Unknown command fields')
  const value = raw as ModelAction
  if (value.action !== 'CHANGE_TEMPLATE_REP_RANGE' || !Number.isSafeInteger(value.minReps) || !Number.isSafeInteger(value.maxReps)
    || value.minReps < 1 || value.maxReps < value.minReps) throw new Error('Unsupported action or invalid rep range')
  if (!Array.isArray(value.candidateRefs) || !value.candidateRefs.length || value.candidateRefs.length > candidates.length
    || Object.getPrototypeOf(value.candidateRefs) !== Array.prototype
    || Reflect.ownKeys(value.candidateRefs).length !== value.candidateRefs.length + 1
    || Reflect.ownKeys(value.candidateRefs).some((key) => key !== 'length' && (typeof key !== 'string'
      || !/^(0|[1-9]\d*)$/.test(key) || Number(key) >= value.candidateRefs.length
      || !('value' in Object.getOwnPropertyDescriptor(value.candidateRefs, key)!)))
    || new Set(value.candidateRefs).size !== value.candidateRefs.length
    || value.candidateRefs.some((ref) => typeof ref !== 'string' || !candidates.some((item) => item.reference === ref))) throw new Error('Invalid candidate allowlist reference')
  return structuredClone(value)
}

export interface ActionReceipt {
  action: 'CHANGE_TEMPLATE_REP_RANGE'; templateId: string; templateExerciseId: string; exerciseId: string
  beforePrescription: string; afterPrescription: string; appliedAt: string; resultingRevision: number
}
export type ActionExecutionResult = { status: 'APPLIED'; receipt: ActionReceipt }
  | { status: 'FAILED' | 'STALE' | 'BLOCKED'; message: string }
  | { status: 'INDETERMINATE'; message: string; reconciliation?: { desiredStatePresent: boolean; observedPrescription?: string } }
export interface TrackingCommandGateway {
  readonly supportsConfirmedTrackingMutations: boolean
  changeTemplateRepRange(plan: TemplateRepRangePlan): Promise<ActionExecutionResult>
}
export interface ActionPreview {
  readonly status: 'PREVIEWED'; readonly confirmationId: string
  readonly plan: Readonly<TemplateRepRangePlan>; readonly templateName: string; readonly exerciseName: string
}
export interface ConfirmedActionPlan { readonly status: 'CONFIRMED'; readonly confirmationId: string }
export type ActionPreparationResult = ActionPreview
  | { status: 'AMBIGUOUS'; candidates: readonly CommandCandidate[] }
  | { status: 'INVALID'; message: string }

// Closed action set. No generic patch, command dispatch, or reflection fallback.
export const ActionDefinitionRegistry = Object.freeze({
  CHANGE_TEMPLATE_REP_RANGE: Object.freeze({ validate, prepare: prepareTemplateRepRange,
    execute: (plan: TemplateRepRangePlan, gateway: TrackingCommandGateway) => gateway.changeTemplateRepRange(plan) }),
})

/** One explicit command session. Neither this executor nor its gateway is referenced by extraction. */
export const createExplicitCommandSession = (gateway: TrackingCommandGateway) => {
  let generation = 0
  let preview: ActionPreview | undefined
  let confirmed: ConfirmedActionPlan | undefined
  let pending: { output: ModelAction; candidates: CommandCandidate[] } | undefined
  const cancel = () => { generation++; preview = undefined; confirmed = undefined; pending = undefined }
  const makePreview = (snapshot: CommandSnapshot, candidate: CommandCandidate, output: ModelAction): ActionPreparationResult => {
    try {
      const current = commandCandidates(snapshot).find((item) => item.reference === candidate.reference)
      if (!current) throw new Error('Candidate no longer exists')
      const plan = Object.freeze(ActionDefinitionRegistry.CHANGE_TEMPLATE_REP_RANGE.prepare(snapshot, current, output.minReps, output.maxReps))
      // Deterministic full-content identity, not a reusable boolean. Runtime object identity also binds confirmation.
      preview = Object.freeze({ status: 'PREVIEWED', confirmationId: JSON.stringify(plan), plan, templateName: current.templateName, exerciseName: current.exerciseName })
      return preview
    } catch (error) { return { status: 'INVALID', message: error instanceof Error ? error.message : 'Invalid target' } }
  }
  return {
    cancel,
    async prepare(input: ExplicitUserCommandInput, snapshot: CommandSnapshot, model: CompanionModel<CommandModelRequest>): Promise<ActionPreparationResult> {
      cancel(); const requestGeneration = generation
      if (!explicitInputs.has(input)) return { status: 'INVALID', message: 'Explicit user command envelope required' }
      explicitInputs.delete(input)
      try {
        const candidates = commandCandidates(snapshot)
        const snapshotAtRequest = structuredClone(snapshot)
        const output = validate(await model.propose({ text: input.text, candidates: structuredClone(candidates) }), candidates)
        if (requestGeneration !== generation) return { status: 'INVALID', message: 'Command cancelled or superseded' }
        const selected = candidates.filter((item) => output.candidateRefs.includes(item.reference))
        if (selected.length > 1) { pending = { output, candidates: selected }; return { status: 'AMBIGUOUS', candidates: structuredClone(selected) } }
        return makePreview(snapshotAtRequest, selected[0], output)
      } catch (error) { return { status: 'INVALID', message: error instanceof Error ? error.message : 'Invalid model response' } }
    },
    resolve(reference: string, snapshot: CommandSnapshot): ActionPreparationResult {
      const candidate = pending?.candidates.find((item) => item.reference === reference)
      if (!pending || !candidate) return { status: 'INVALID', message: 'Choose an exact offered candidate' }
      const output = pending.output; pending = undefined
      return makePreview(snapshot, candidate, output)
    },
    confirm(candidate: ActionPreview): ConfirmedActionPlan {
      if (candidate !== preview || confirmed) throw new Error('Preview expired or already confirmed')
      confirmed = Object.freeze({ status: 'CONFIRMED', confirmationId: candidate.confirmationId }); return confirmed
    },
    async execute(plan: ConfirmedActionPlan): Promise<ActionExecutionResult> {
      if (plan !== confirmed || !preview) return { status: 'FAILED', message: 'Invalid or consumed confirmation' }
      const action = preview.plan; cancel() // consume before awaiting; never automatically retry
      if (!gateway.supportsConfirmedTrackingMutations) return { status: 'BLOCKED', message: 'Safe Desktop persistence required' }
      try { return await ActionDefinitionRegistry.CHANGE_TEMPLATE_REP_RANGE.execute(action, gateway) }
      catch { return { status: 'INDETERMINATE', message: 'Gateway outcome unavailable; refresh before retrying' } }
    },
  }
}
