export type SyncLabel = 'Synced' | 'Changes waiting'

export const syncLabelForTransmittable = (transmittablePendingChanges: number): SyncLabel =>
  transmittablePendingChanges > 0 ? 'Changes waiting' : 'Synced'
