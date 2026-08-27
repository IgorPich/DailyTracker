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
} from './types'
export type { AppDataStore } from './appDataStore'

export { deleteDailyEntry, findDailyEntryByDate, upsertDailyEntry } from './dailyEntryOperations'
export { addGymLocation, deleteGymLocation, renameGymLocation } from './gymOperations'
export { insertTemplateExercise, moveItem, removeTemplateExercise, replaceTrainingTemplate } from './templateOperations'
export { addWorkout, deleteWorkout, findWorkoutById, updateWorkout } from './workoutOperations'
export {
  canonicalExerciseId,
  exerciseDefinitionFor,
  findExerciseDefinitionByName,
  matchingExerciseDefinitionsByName,
  normalizeExerciseName,
  renameExerciseDefinition,
  withRegisteredExercise,
} from './exerciseIdentity'
export type { ExerciseReference } from './exerciseIdentity'
export {
  decimalInputValue,
  formatDecimal,
  normalizeDecimalInput,
} from './numbers'
export {
  exerciseOccurrencesByWorkout,
  exercisesMatch,
  mergeWorkoutExercises,
  moveExercise,
  previousExerciseOccurrence,
  replaceWorkoutById,
} from './workoutData'
export type { ExerciseOccurrence } from './workoutData'
export {
  compareExercises,
  compareSets,
  equipmentComparisonIssue,
  formatGymName,
  formatSet,
  getBestSet,
  isEquipmentSensitive,
  prescriptionRepRange,
} from './workoutProgress'
export type { ProgressResult } from './workoutProgress'
export { DEFAULT_TEMPLATES } from './defaultTemplates'
