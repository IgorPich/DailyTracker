import { reportSelection } from '@greekgod/analytics'
import type { AppData } from '@greekgod/core'
import { coachReportProgress } from './coachReportProgress.ts'

export const coachReportSelection = (
  data: Pick<AppData, 'exerciseLibrary' | 'workouts' | 'templates'>,
  recentFrom: string,
  asOf: string,
) => {
  const selection = reportSelection({ snapshot: data, recentFrom, asOf })
  return {
    ...selection,
    selectedExercises: selection.selectedExercises.map((selected) => ({
      ...selected,
      ...coachReportProgress(selected.progress),
      // Policy already excludes missing/ambiguous definitions; names only label rows.
      definition: data.exerciseLibrary.find((definition) => definition.id === selected.exerciseId)!,
    })),
  }
}
