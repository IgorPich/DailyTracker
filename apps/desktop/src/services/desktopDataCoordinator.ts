import type { AppData, AppDataStore, TemplateRepRangePlan } from '@greekgod/core'
import type { ConfirmedTrackingPersistence, TrackingMutationResult } from './confirmedTrackingMutation.ts'

type Update = AppData | ((current: AppData) => AppData)

/** Coordinates React publication with the existing store; never implements a second durable queue. */
export class DesktopDataCoordinator {
  private current: AppData
  private busy = false
  private refreshRequired = false
  private uncertainPlan?: TemplateRepRangePlan
  private deferred: Update[] = []
  private generation = 0
  constructor(initial: AppData, private readonly store: AppDataStore & Partial<ConfirmedTrackingPersistence>,
    private readonly publish: (data: AppData) => void, private readonly onError: (error: unknown) => void,
    private readonly publishOutcome: (result: TrackingMutationResult) => void = () => {}) { this.current = initial }
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
  async poll() {
    if (this.busy) return
    if (this.refreshRequired) {
      const current = await this.store.load()
      this.initialize(current); this.refreshRequired = false
      if (this.uncertainPlan) { this.publishOutcome(this.observedOutcome(current, this.uncertainPlan)); this.uncertainPlan = undefined }
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
}
