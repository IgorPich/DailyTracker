import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { basename, dirname, resolve } from 'node:path'
import { validateHumanCoachContext } from '../../../packages/human-coach/src/domain/context.ts'
import { validateMemoryState } from '../../../packages/companion/src/memory/memory.ts'

const [rootArgument, productionArgument] = process.argv.slice(2)
if (!rootArgument || !productionArgument) throw new Error('Expected isolated and production AppData roots.')
const smokeRoot = resolve(rootArgument)
const productionRoot = resolve(productionArgument)
assert.equal(basename(smokeRoot).toLocaleLowerCase(), 'com.igorpich.formlog.schema8smoke')
assert.notEqual(smokeRoot.toLocaleLowerCase(), productionRoot.toLocaleLowerCase())
assert.ok(!smokeRoot.toLocaleLowerCase().startsWith(`${productionRoot.toLocaleLowerCase()}\\`))
assert.ok(!productionRoot.toLocaleLowerCase().startsWith(`${smokeRoot.toLocaleLowerCase()}\\`))
assert.equal(dirname(smokeRoot).toLocaleLowerCase(), dirname(productionRoot).toLocaleLowerCase())

const exerciseId = 'synthetic-exercise-squat'
const templateId = 'synthetic-template-alpha'
const templateExerciseId = 'synthetic-template-row-squat'
const workout = (id, date, duration, weight, reps) => ({
  id,
  date,
  templateId,
  templateCode: 'SYN',
  templateName: 'Plan syntetyczny',
  duration,
  gymLocation: 'Obiekt syntetyczny',
  exercises: [{
    id: `${id}-row`, exerciseId, name: 'Przysiad próbny', prescription: '3 × 5–7',
    sets: [{ id: `${id}-set`, weight, reps, rir: 2 }], equipmentSensitive: false,
  }],
})
const appData = {
  version: 4,
  dailyEntries: [
    { id: 'synthetic-daily-2026-09-16', date: '2026-09-16', weight: 80.5, note: 'Dane wyłącznie syntetyczne.' },
  ],
  workouts: [
    workout('synthetic-workout-1', '2026-09-15', 35, 60, 7),
    workout('synthetic-workout-2', '2026-09-16', 40, 62.5, 6),
    workout('synthetic-workout-3', '2026-09-17', 45, 65, 5),
  ],
  templates: [{
    id: templateId, code: 'SYN', name: 'Plan syntetyczny', exercises: [{
      id: templateExerciseId, exerciseId, name: 'Przysiad próbny', aliases: undefined,
      prescription: '3 × 5–7', defaultSets: 3, equipmentSensitive: false,
    }],
  }],
  exerciseLibrary: [{
    id: exerciseId, name: 'Przysiad próbny', aliases: ['Przysiadu próbnego'], equipmentSensitive: false,
  }],
  settings: {
    phase: 'Maintenance', calorieTarget: 2500, proteinTarget: 160,
    gymLocations: ['Obiekt syntetyczny'], lastGymLocation: 'Obiekt syntetyczny',
    trendThresholds: { lossBelow: -0.15, stableUpper: 0.05, slowGainUpper: 0.2 },
  },
  coachNotes: {},
}
const humanCoach = {
  version: 1,
  items: [{
    id: 'synthetic-coach-decision-private-47', kind: 'DECISION',
    text: 'Priorytetem jest spokojna technika w ruchu syntetycznym.', exerciseIds: [exerciseId],
    createdAt: '2026-09-01T10:00:00.000Z',
    provenance: { sourceType: 'MANUAL', createdAt: '2026-09-01T10:00:00.000Z' },
    acceptance: { state: 'AUTHORITATIVE', acceptedAt: '2026-09-01T10:01:00.000Z' },
  }],
}
const memory = {
  version: 1,
  items: [{
    id: 'synthetic-memory-private-31', content: { kind: 'SUMMARY_STYLE', value: 'SHORT' },
    scope: { kind: 'GLOBAL' }, expiresAt: null, source: 'USER_EXPLICIT',
    createdAt: '2026-09-01T10:00:00.000Z', provenance: { acceptedBy: 'USER', sourceId: null }, status: 'ACTIVE',
  }],
}
validateHumanCoachContext(humanCoach)
validateMemoryState(memory)

await mkdir(smokeRoot, { recursive: true })
await Promise.all([
  writeFile(resolve(smokeRoot, 'formlog.store.json'), `${JSON.stringify({ appData }, null, 2)}\n`, { flag: 'wx' }),
  writeFile(resolve(smokeRoot, 'greekgod-human-coach.dev.v1.json'), `${JSON.stringify({ context: humanCoach }, null, 2)}\n`, { flag: 'wx' }),
  writeFile(resolve(smokeRoot, 'greekgod-companion-memory.dev.v1.json'), `${JSON.stringify({ memory }, null, 2)}\n`, { flag: 'wx' }),
  writeFile(resolve(smokeRoot, 'companion-ux-smoke-fixture.json'), `${JSON.stringify({
    syntheticOnly: true,
    expectedWorkoutCount30Days: 3,
    expectedDurationMinutes30Days: 120,
    analyticsQuestion: 'Ile treningów wykonałem w ostatnich 30 dniach?',
    memoryQuestion: 'Jaką pamiętasz preferencję podsumowania?',
    humanCoachQuestion: 'Co ustaliliśmy z trenerem?',
    mutationLikeDialogue: 'Zmień zakres powtórzeń w tym ćwiczeniu na 10–15.',
    explicitCommand: 'Ustaw dla Przysiadu próbnego zakres od 6 do 8 powtórzeń.',
    originalPrescription: '3 × 5–7',
    expectedPrescription: '3 × 6–8',
    privateIdsNeverVisible: [exerciseId, templateId, templateExerciseId, humanCoach.items[0].id, memory.items[0].id],
  }, null, 2)}\n`, { flag: 'wx' }),
])
console.log(JSON.stringify({ smokeRoot, syntheticOnly: true, workouts: 3, durationMinutes: 120 }))
