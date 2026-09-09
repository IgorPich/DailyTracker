import assert from 'node:assert/strict'
import type { AppData } from '@greekgod/core'
import { progressExerciseExposureHistory } from '../src/adapters/progressExerciseExposureHistory.ts'

const exerciseId = 'synthetic-progress-exercise'
const data: Pick<AppData, 'exerciseLibrary' | 'workouts'> = {
  exerciseLibrary: [{ id: exerciseId, name: 'Synthetic progress exercise', equipmentSensitive: false }],
  workouts: [
    {
      id: 'newer-workout',
      date: '2026-02-02',
      templateId: 'synthetic-template',
      templateCode: 'A',
      templateName: 'Synthetic template',
      exercises: [{
        id: 'newer-reference',
        exerciseId,
        name: 'Newer snapshot',
        prescription: '2 × 6–8',
        sets: [
          { id: 'newer-set-1', weight: 22.5, reps: 8 },
          { id: 'newer-set-2', weight: 25, reps: 7 },
        ],
      }],
    },
    {
      id: 'older-workout',
      date: '2026-02-01',
      templateId: 'synthetic-template',
      templateCode: 'A',
      templateName: 'Synthetic template',
      exercises: [{
        id: 'older-reference',
        exerciseId,
        name: 'Older snapshot',
        prescription: '2 × 6–8',
        sets: [{ id: 'older-set', weight: 20, reps: 8 }],
      }],
    },
  ],
}

const result = progressExerciseExposureHistory(data, exerciseId, '2026-02-03')

assert.equal(result.identityStatus, 'READY')
assert.equal(result.excludedIdentityReferences, 0)
assert.deepEqual(result.occurrences.map((item) => item.workoutId), ['older-workout', 'newer-workout'])
assert.deepEqual(result.occurrences[1].workingSets.map((set) => set.id), ['newer-set-1', 'newer-set-2'])
assert.equal(result.occurrences[1].bestSet.id, 'newer-set-2')

console.log('PASS Desktop Progress consumes ExerciseExposureHistory in chronological display order')
