import type { ExerciseExposure, ExerciseProgressResult, ExerciseProgressStatus } from '@greekgod/analytics'
import { getBestSet } from '@greekgod/core'

const statusPresentation = {
  PROGRESS: { label: 'Progres', tone: 'positive' },
  REGRESSION: { label: 'Regres', tone: 'negative' },
  FLAT: { label: 'Bez zmian', tone: 'neutral' },
  NOT_COMPARABLE: { label: 'Brak porównywalności', tone: 'neutral' },
  INSUFFICIENT_DATA: { label: 'Za mało danych', tone: 'neutral' },
} as const satisfies Record<ExerciseProgressStatus, { label: string; tone: string }>

// Presentation only: Analytics owns the verdict and the comparison exposure.
export const coachReportProgress = (progress: ExerciseProgressResult) => {
  const change: { label: string; tone: 'positive' | 'negative' | 'neutral' } = { ...statusPresentation[progress.status] }
  if (progress.status === 'FLAT') {
    if (progress.reasonCodes.includes('MIXED_SET_PERFORMANCE')) change.label = 'Wyniki mieszane'
    else if (progress.reasonCodes.includes('PERFORMANCE_TRADE_OFF')) change.label = 'Kompromis ciężar / powtórzenia'
    else if (progress.reasonCodes.includes('SET_COUNT_CHANGED')) change.label = 'Zmieniona liczba serii'
  }
  if (progress.status === 'NOT_COMPARABLE') {
    if (progress.reasonCodes.includes('DIFFERENT_GYM_EQUIPMENT')) change.label = 'Inny kontekst sprzętu'
    else if (progress.reasonCodes.includes('MISSING_GYM_CONTEXT')) change.label = 'Brak kontekstu siłowni'
  }
  if (progress.status === 'INSUFFICIENT_DATA' && progress.reasonCodes.includes('NO_PREVIOUS_EXPOSURE')) {
    change.label = 'Brak poprzedniej ekspozycji'
  }
  const current = exposureFacts(progress.currentExposure)
  const previous = exposureFacts(progress.comparisonExposure)
  return { change, current, previous, currentSet: current?.bestSet, previousSet: previous?.bestSet }
}

const exposureFacts = (exposure: ExerciseExposure | undefined) => exposure && ({
  workout: { id: exposure.workoutId, date: exposure.occurredOn, gymLocation: exposure.gymContext },
  bestSet: getBestSet({
    id: exposure.workoutExerciseId,
    exerciseId: exposure.exerciseId,
    name: exposure.displayNameSnapshot,
    prescription: exposure.prescriptionSnapshot,
    sets: exposure.workingSets.map(({ setId, weight, reps, rir }) => ({ id: setId, weight, reps, rir })),
  }),
})
