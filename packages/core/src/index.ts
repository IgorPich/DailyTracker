export type {
  AppData,
  DailyEntry,
  ExerciseDefinition,
  Phase,
  Settings,
  TemplateExercise,
  TrainingTemplate,
  TrendThresholds,
  Workout,
  WorkoutExercise,
  WorkoutSet,
} from './types.ts'
export type { AppDataStore } from './appDataStore.ts'

export { deleteDailyEntry, findDailyEntryByDate, upsertDailyEntry } from './dailyEntryOperations.ts'
export { addGymLocation, deleteGymLocation, renameGymLocation } from './gymOperations.ts'
export { insertTemplateExercise, moveItem, removeTemplateExercise, replaceTrainingTemplate } from './templateOperations.ts'
export { addWorkout, deleteWorkout, findWorkoutById, updateWorkout } from './workoutOperations.ts'
export {
  canonicalExerciseId,
  exerciseDefinitionFor,
  findExerciseDefinitionByName,
  matchingExerciseDefinitionsByName,
  normalizeExerciseName,
  renameExerciseDefinition,
  withRegisteredExercise,
} from './exerciseIdentity.ts'
export type { ExerciseReference } from './exerciseIdentity.ts'
export {
  decimalInputValue,
  formatDecimal,
  normalizeDecimalInput,
} from './numbers.ts'
export {
  exerciseOccurrencesByWorkout,
  exercisesMatch,
  mergeWorkoutExercises,
  moveExercise,
  previousExerciseOccurrence,
  replaceWorkoutById,
} from './workoutData.ts'
export type { ExerciseOccurrence } from './workoutData.ts'
export {
  compareExercises,
  compareSets,
  equipmentComparisonIssue,
  formatGymName,
  formatSet,
  getBestSet,
  isEquipmentSensitive,
  prescriptionRepRange,
} from './workoutProgress.ts'
export type { ProgressResult } from './workoutProgress.ts'
export { DEFAULT_TEMPLATES } from './defaultTemplates.ts'
