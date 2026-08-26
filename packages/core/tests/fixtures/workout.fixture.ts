import type { Workout, WorkoutExercise, WorkoutSet } from '../../src/types.ts'

export const workoutSetFixture = (
  id: string,
  weight: number,
  reps: number,
  rir: number,
): WorkoutSet => ({ id, weight, reps, rir })

export const workoutExerciseFixture = (
  id: string,
  fields: Partial<WorkoutExercise> = {},
): WorkoutExercise => ({
  id,
  exerciseId: `canonical-${id}`,
  name: `Synthetic snapshot ${id}`,
  prescription: '2 × 6–10',
  sets: [
    workoutSetFixture(`${id}-set-b`, 55, 7, 1),
    workoutSetFixture(`${id}-set-a`, 50, 9, 2),
  ],
  skipped: false,
  isCustom: true,
  equipmentSensitive: true,
  note: `Synthetic exercise note ${id}`,
  ...fields,
})

export const workoutFixture = (
  id: string,
  fields: Partial<Workout> = {},
): Workout => ({
  id,
  date: '2026-08-20',
  templateId: 'fixture-template-a',
  templateCode: 'A',
  templateName: 'SYNTHETIC A',
  exercises: [
    workoutExerciseFixture(`${id}-exercise-b`, {
      exerciseId: 'canonical-historical-row',
      name: 'Historyczny snapshot wiosła',
    }),
    workoutExerciseFixture(`${id}-exercise-a`, {
      exerciseId: 'canonical-historical-press',
      name: 'Historyczny snapshot wyciskania',
      equipmentSensitive: false,
    }),
  ],
  duration: 73,
  gymLocation: 'Klub Syntetyczny Północ',
  note: `Synthetic workout note ${id}`,
  ...fields,
})
