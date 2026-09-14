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
export { insertTemplateExercise, moveItem, removeTemplateExercise, replaceTrainingTemplate, replaceTemplateExerciseDefinition } from './templateOperations.ts'
export { addWorkout, deleteWorkout, findWorkoutById, updateWorkout } from './workoutOperations.ts'
export {
  canonicalExerciseId,
  classifyExerciseIdentity,
  exerciseDefinitionFor,
  normalizeExerciseName,
  registerExerciseDefinition,
  renameExerciseDefinition,
  resolvedExerciseDefinitionId,
  resolveTemplateExerciseId,
  UNRESOLVED_EXERCISE_IDENTITY,
} from './exerciseIdentity.ts'
export type { ExerciseIdentityIssueReason, ExerciseIdentityResolution, ExerciseReference } from './exerciseIdentity.ts'
export { auditExerciseIdentities } from './exerciseIdentityAudit.ts'
export type { ExerciseIdentityAuditIssue, ExerciseIdentityAuditResult } from './exerciseIdentityAudit.ts'
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
export { classifyExerciseComparability } from './exerciseComparability.ts'
export type { ExerciseComparability } from './exerciseComparability.ts'
export { classifySetPerformance } from './setPerformanceComparison.ts'
export type {
  RepRange,
  SetPerformanceComparison,
  SetPerformanceOutcome,
  SetPerformanceReason,
} from './setPerformanceComparison.ts'
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
export { DEFAULT_TEMPLATES, DESKTOP_DEFAULT_TEMPLATES } from './defaultTemplates.ts'
export { prepareTemplateRepRange, changeTemplateRepRange, templateStateVersion } from './changeTemplateRepRange.ts'
export type { TemplateRepRangePlan } from './changeTemplateRepRange.ts'
export { programVersion, openProgramDraft, validateProgram, applyProgram, duplicateProgramTemplate, reorderProgramItems } from './program.ts'
export type { ProgramPlan } from './program.ts'
