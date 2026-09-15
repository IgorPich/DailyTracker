import { applyDailyEntryEdit, type DailyEntryEdit } from '@greekgod/core'
import type { MobileSnapshot, MobileStore } from './mobileStore.ts'

export type DailyEditResult = { status: 'APPLIED'; snapshot: MobileSnapshot } | { status: 'STALE' | 'FAILED' | 'INDETERMINATE'; message: string }
const cas = (error: unknown) => !!error && typeof error === 'object' && 'kind' in error && error.kind === 'revision-conflict'
/** Called inside the provider's existing queue. A retry rebuilds only the explicit patch. */
export const persistDailyEntryEdit = async (store: MobileStore, request: DailyEntryEdit): Promise<DailyEditResult> => {
  const plan = structuredClone(request)
  for (let attempt = 0; attempt < 2; attempt++) {
    let current: MobileSnapshot
    try { current = await store.load() } catch { return { status: 'FAILED', message: 'Nie można odczytać świeżych danych.' } }
    let desired
    try { desired = applyDailyEntryEdit(current.data, plan) }
    catch (error) { return { status: 'STALE', message: `Odśwież i przejrzyj wpis: ${String(error)}` } }
    if (desired === current.data) return { status: 'APPLIED', snapshot: current }
    try { return { status: 'APPLIED', snapshot: await store.save(desired, current.revision) } }
    catch (error) {
      if (cas(error)) {
        if (attempt === 0) continue
        return { status: 'STALE', message: 'Dane ponownie się zmieniły. Odśwież i przejrzyj wpis.' }
      }
      // An unknown acknowledgement may follow a committed write. Never automatically replay it.
      return { status: 'INDETERMINATE', message: 'Niepewne potwierdzenie zapisu. Odśwież i sprawdź dane; nie ponawiaj automatycznie.' }
    }
  }
  return { status: 'STALE', message: 'Odśwież dane.' }
}
