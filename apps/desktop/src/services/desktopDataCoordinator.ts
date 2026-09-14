import type { AppData, AppDataStore, TemplateRepRangePlan } from '@greekgod/core'
import type { ConfirmedTrackingPersistence, TrackingMutationResult } from './confirmedTrackingMutation.ts'
import { programVersion, type ProgramPlan } from '@greekgod/core'
import type { ProgramPersistence, ProgramSaveResult } from './programPersistence.ts'

type Update = AppData | ((current: AppData) => AppData)

/** Coordinates React publication with the existing store; never implements a second durable queue. */
export class DesktopDataCoordinator {
  private current: AppData
  private busy = false
  private refreshRequired = false
  private uncertainPlan?: TemplateRepRangePlan
  private uncertainProgram?: ProgramPlan
  private deferred: Update[] = []
  private generation = 0
  constructor(initial: AppData, private readonly store: AppDataStore & Partial<ConfirmedTrackingPersistence & ProgramPersistence>,
    private readonly publish: (data: AppData) => void, private readonly onError: (error: unknown) => void,
    private readonly publishOutcome: (result: TrackingMutationResult) => void = () => {},
    private readonly publishProgramOutcome: (result: ProgramSaveResult) => void = () => {}) { this.current = initial }
  private observedOutcome(data: AppData, plan: TemplateRepRangePlan): TrackingMutationResult {
    const templates = data.templates.filter((item) => item.id === plan.templateId)
    const rows = templates.length === 1 ? templates[0].exercises.filter((row) => row.id === plan.templateExerciseId) : []
    const row = rows.length === 1 ? rows[0] : undefined
    return { status: 'INDETERMINATE', message: 'Write attribution is uncertain; authoritative state has now been read without replay',
      reconciliation: { desiredStatePresent: row?.exerciseId === plan.exerciseId && row?.prescription === plan.afterPrescription,
        ...(row ? { observedPrescription: row.prescription } : {}) } }
  }
  initialize(data: AppData) { this.current = data; this.publish(data) }
  update = (update: Update) => {
    if (this.busy || this.refreshRequired) { this.deferred.push(update); return }
    this.generation++
    this.current = typeof update === 'function' ? update(this.current) : update
    this.publish(this.current)
    void this.store.save(this.current).catch(this.onError)
  }
  get supportsConfirmedTrackingMutations() { return !this.refreshRequired && this.store.supportsConfirmedTrackingMutations === true }
  get supportsProgramSave() { return !this.refreshRequired && this.store.supportsProgramSave === true }
  private observedProgram(data: AppData, plan: ProgramPlan): ProgramSaveResult {
    return { status: 'INDETERMINATE', message: 'Fresh authority verified without replay', desiredProgramPresent: programVersion(data.templates) === programVersion(plan.templates) }
  }
  async poll() {
    if (this.busy) return
    if (this.refreshRequired) {
      const current = await this.store.load()
      this.initialize(current); this.refreshRequired = false
      if (this.uncertainPlan) { this.publishOutcome(this.observedOutcome(current, this.uncertainPlan)); this.uncertainPlan = undefined }
      if (this.uncertainProgram) { this.publishProgramOutcome(this.observedProgram(current, this.uncertainProgram)); this.uncertainProgram = undefined }
      const deferred = this.deferred; this.deferred = []; deferred.forEach(this.update)
      return
    }
    const generation = this.generation
    const changed = await this.store.loadIfChanged?.()
    if (changed && !this.busy && generation === this.generation) this.initialize(changed)
  }
  async changeTemplateRepRange(plan: TemplateRepRangePlan): Promise<TrackingMutationResult> {
    if (this.busy || !this.supportsConfirmedTrackingMutations || !this.store.changeTemplateRepRange) return { status: 'BLOCKED', message: 'Safe Desktop persistence is required or another command is pending' }
    this.busy = true; this.generation++
    let result: TrackingMutationResult
    try {
      result = await this.store.changeTemplateRepRange(plan)
      if (result.status === 'APPLIED') this.initialize(result.data) // committed result: NO save
      else {
        const current = await this.store.load(); this.initialize(current)
        if (result.status === 'INDETERMINATE') result = this.observedOutcome(current, plan)
      }
    } catch { this.refreshRequired = true; this.uncertainPlan = structuredClone(plan); result = { status: 'INDETERMINATE', message: 'Persistence/reconciliation unavailable; ordinary edits are held until refresh succeeds' } }
    finally {
      this.busy = false
      if (!this.refreshRequired) { const deferred = this.deferred; this.deferred = []; deferred.forEach(this.update) }
    }
    this.publishOutcome(result)
    return result
  }
  async saveProgram(plan: ProgramPlan): Promise<ProgramSaveResult> {
    if (this.busy || !this.supportsProgramSave || !this.store.saveProgram) return { status: 'BLOCKED', message: 'Safe persistence unavailable or another write is pending' }
    const confirmed = structuredClone(plan)
    this.busy = true; this.generation++
    let result: ProgramSaveResult
    try {
      result = await this.store.saveProgram(confirmed)
      if (result.status === 'APPLIED') this.initialize(result.data)
      else {
        const current = await this.store.load(); this.initialize(current)
        if (result.status === 'INDETERMINATE') result = this.observedProgram(current, confirmed)
      }
    } catch {
      this.refreshRequired = true; this.uncertainProgram = confirmed
      result = { status: 'INDETERMINATE', message: 'Reconciliation unavailable; further changes held until fresh authority returns' }
    } finally {
      this.busy = false
      if (!this.refreshRequired) { const deferred = this.deferred; this.deferred = []; deferred.forEach(this.update) }
    }
    this.publishProgramOutcome(result)
    return result
  }
}
