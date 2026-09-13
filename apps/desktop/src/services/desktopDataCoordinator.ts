import type { AppData, AppDataStore, TemplateRepRangePlan } from '@greekgod/core'
import type { ConfirmedTrackingPersistence, TrackingMutationResult } from './confirmedTrackingMutation.ts'

type Update = AppData | ((current: AppData) => AppData)

/** Coordinates React publication with the existing store; never implements a second durable queue. */
export class DesktopDataCoordinator {
  private current: AppData
  private busy = false
  private deferred: Update[] = []
  private generation = 0
  constructor(initial: AppData, private readonly store: AppDataStore & Partial<ConfirmedTrackingPersistence>,
    private readonly publish: (data: AppData) => void, private readonly onError: (error: unknown) => void) { this.current = initial }
  initialize(data: AppData) { this.current = data; this.publish(data) }
  update = (update: Update) => {
    if (this.busy) { this.deferred.push(update); return }
    this.generation++
    this.current = typeof update === 'function' ? update(this.current) : update
    this.publish(this.current)
    void this.store.save(this.current).catch(this.onError)
  }
  get supportsConfirmedTrackingMutations() { return this.store.supportsConfirmedTrackingMutations === true }
  async poll() {
    if (this.busy) return
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
      else this.initialize(await this.store.load())
    } catch { result = { status: 'FAILED', message: 'Persistence/reconciliation failed; reload before retrying' } }
    finally {
      this.busy = false
      const deferred = this.deferred; this.deferred = []
      deferred.forEach(this.update)
    }
    return result
  }
}
