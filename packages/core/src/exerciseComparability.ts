export type ExerciseComparability =
  | { status: 'COMPARABLE'; reason: 'EQUIPMENT_INDEPENDENT' | 'SAME_GYM' }
  | { status: 'NOT_COMPARABLE'; reason: 'MISSING_GYM_CONTEXT' | 'DIFFERENT_GYM' }

const normalizedGymLocation = (location?: string) => location?.trim().toLocaleLowerCase('pl-PL') || undefined

export const classifyExerciseComparability = (
  equipmentSensitive: boolean,
  currentGymLocation?: string,
  previousGymLocation?: string,
): ExerciseComparability => {
  if (!equipmentSensitive) return { status: 'COMPARABLE', reason: 'EQUIPMENT_INDEPENDENT' }
  const currentGym = normalizedGymLocation(currentGymLocation)
  const previousGym = normalizedGymLocation(previousGymLocation)
  if (!currentGym || !previousGym) return { status: 'NOT_COMPARABLE', reason: 'MISSING_GYM_CONTEXT' }
  return currentGym === previousGym
    ? { status: 'COMPARABLE', reason: 'SAME_GYM' }
    : { status: 'NOT_COMPARABLE', reason: 'DIFFERENT_GYM' }
}
