import type {
  DailyEntry,
  TemplateExercise,
  TrainingTemplate,
  Workout,
  WorkoutExercise,
  WorkoutSet,
} from '../../src/types'

// Entirely synthetic data. Keep this fixture free of IDs, measurements and
// locations copied from a real user Store.
export const fixtureSet = (id: string, weight: number, reps: number, rir?: number): WorkoutSet => ({
  id,
  weight,
  reps,
  ...(rir === undefined ? {} : { rir }),
})

export const fixtureTemplateExercise = (
  id: string,
  name: string,
  equipmentSensitive = false,
  prescription = '1 × 6–12',
): TemplateExercise => ({
  id,
  name,
  prescription,
  defaultSets: 1,
  equipmentSensitive,
})

export const fixtureWorkoutExercise = (
  id: string,
  name: string,
  sets: WorkoutSet[],
  equipmentSensitive = false,
  extras: Partial<WorkoutExercise> = {},
): WorkoutExercise => ({
  id,
  name,
  prescription: '1 × 6–12',
  sets,
  equipmentSensitive,
  ...extras,
})

export const fixtureWorkout = (
  id: string,
  date: string,
  templateId: string,
  templateCode: Workout['templateCode'],
  templateName: string,
  gymLocation: string,
  exercises: WorkoutExercise[],
): Workout => ({
  id,
  date,
  templateId,
  templateCode,
  templateName,
  gymLocation,
  duration: 73,
  note: `Synthetic note ${id}`,
  exercises,
})

export const legacyTemplatesFixture: TrainingTemplate[] = [
  {
    id: 'fixture-push',
    code: 'A',
    name: 'PUSH',
    exercises: [
      fixtureTemplateExercise('a-shared-press', '  Wyciskanie testowe  '),
      fixtureTemplateExercise('chest-supported-row', 'Wiosło na wyciągu', true),
      fixtureTemplateExercise('rear-delt-machine', 'Odwrotne rozpiętki na maszynie', true),
      fixtureTemplateExercise('overhead-triceps-extension', 'Prostowanie ramion nad głową z sztangą na leżąco'),
    ],
  },
  {
    id: 'fixture-upper',
    code: 'D',
    name: 'GRECKA GÓRA',
    exercises: [
      fixtureTemplateExercise('d-shared-press', 'wyciskanie TESTOWE'),
      fixtureTemplateExercise('machine-row', 'Wiosło   na wyciągu', true),
      fixtureTemplateExercise('reverse-fly', 'Odwrotne rozpiętki na maszynie', true),
      fixtureTemplateExercise('lateral-raise-cable', 'Unoszenie bokiem na wyciągu / maszynie', true),
      fixtureTemplateExercise('overhead-triceps-extension-d', 'Prostowanie ramion nad głową z sztangą na leżąco', true),
    ],
  },
]

export const legacyWorkoutsFixture: Workout[] = [
  fixtureWorkout('fixture-workout-a-1', '2026-01-01', 'fixture-push', 'A', 'PUSH', 'Klub Północ', [
    fixtureWorkoutExercise('a-shared-press', 'Wyciskanie testowe', [fixtureSet('set-a-press-1', 10, 10, 2)], false, {
      note: 'Synthetic first result',
    }),
    fixtureWorkoutExercise('custom-cable-row', 'Wiosło na wyciągu', [fixtureSet('set-a-row-1', 80, 8)], true, {
      isCustom: true,
    }),
    fixtureWorkoutExercise('overhead-triceps-extension', 'Prostowanie ramion nad głową z sztangą na leżąco', [
      fixtureSet('set-a-triceps-1', 25, 15),
    ]),
  ]),
  fixtureWorkout('fixture-workout-d-2', '2026-01-02', 'fixture-upper', 'D', 'GRECKA GÓRA', 'Klub Południe', [
    fixtureWorkoutExercise('d-shared-press', ' wyciskanie testowe ', [fixtureSet('set-d-press-1', 10, 12)], false, {
      note: 'Synthetic latest result',
    }),
    fixtureWorkoutExercise('machine-row', 'Wiosło na wyciągu', [fixtureSet('set-d-row-1', 60, 10)], true),
    fixtureWorkoutExercise('reverse-fly', 'Odwrotne rozpiętki na maszynie', [fixtureSet('set-d-rear-1', 49.5, 14)], true),
    fixtureWorkoutExercise('overhead-triceps-extension-d', 'Prostowanie ramion nad głową z sztangą na leżąco', [
      fixtureSet('set-d-triceps-1', 35, 6),
    ]),
  ]),
  fixtureWorkout('fixture-workout-d-3', '2026-01-03', 'fixture-upper', 'D', 'GRECKA GÓRA', 'Klub Północ', [
    fixtureWorkoutExercise('machine-row', 'Wiosło na maszynie', [fixtureSet('set-machine-row-1', 100, 9)], true),
    fixtureWorkoutExercise('custom-dumbbell-raise', 'Unoszenie bokiem z hantalmi', [
      fixtureSet('set-dumbbell-1', 12.5, 14),
      fixtureSet('set-dumbbell-2', 14, 12),
    ], false, { isCustom: true, note: 'Synthetic legacy spelling snapshot' }),
  ]),
]

export const legacyDailyEntryFixture: DailyEntry = {
  id: 'fixture-daily-entry-1',
  date: '2026-01-01',
  weight: 80.5,
  calories: 2800,
  protein: 160,
  fat: 71,
  carbs: 330,
  steps: 9000,
  waist: 80,
  note: 'Synthetic daily entry',
}

export const legacyV2Fixture = {
  version: 2,
  dailyEntries: [legacyDailyEntryFixture],
  workouts: legacyWorkoutsFixture,
  templates: legacyTemplatesFixture,
  settings: {
    phase: 'Maintenance' as const,
    calorieTarget: 2800,
    proteinTarget: 160,
    trendThresholds: { lossBelow: -0.15, stableUpper: 0.05, slowGainUpper: 0.2 },
  },
  coachNotes: { fixture: 'Synthetic coach note' },
}
