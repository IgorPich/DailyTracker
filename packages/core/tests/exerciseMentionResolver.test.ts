import assert from 'node:assert/strict'
import test from 'node:test'
import { renameExerciseDefinition, resolveUniqueExerciseMention } from '../src/index.ts'

const definition = (id: string, name: string, aliases?: string[]) => ({ id, name, aliases, equipmentSensitive: false })

test('authoritative mention resolver accepts canonical names and exact aliases', () => {
  assert.deepEqual(resolveUniqueExerciseMention('Zapisz Żuraw.', [definition('runtime-1', 'Żuraw')]),
    { classification: 'RESOLVED', exerciseId: 'runtime-1', authoritativeMention: 'Żuraw' })
  assert.deepEqual(resolveUniqueExerciseMention('Ustaw dla Przysiadu próbnego zakres.', [
    definition('runtime-2', 'Przysiad próbny', ['Przysiadu próbnego']),
  ]), { classification: 'RESOLVED', exerciseId: 'runtime-2', authoritativeMention: 'Przysiadu próbnego' })
})

test('allowlist membership never establishes identity', () => {
  assert.deepEqual(resolveUniqueExerciseMention('Zapisz ruch spoza listy.', [definition('only', 'Żuraw')]),
    { classification: 'UNRESOLVED', reason: 'NO_MENTION' })
  assert.deepEqual(resolveUniqueExerciseMention('Zapisz Żurawia.', [definition('only', 'Żuraw')]),
    { classification: 'UNRESOLVED', reason: 'NO_MENTION' })
})

test('shared aliases and multiple distinct exercise mentions fail closed independent of order', () => {
  const shared = [definition('a', 'Ruch A', ['Ruch wspólny']), definition('b', 'Ruch B', ['Ruch wspólny'])]
  assert.deepEqual(resolveUniqueExerciseMention('Zapisz Ruch wspólny.', shared),
    { classification: 'UNRESOLVED', reason: 'AMBIGUOUS_MENTION' })
  const distinct = [definition('a', 'Ruch A'), definition('b', 'Ruch B')]
  assert.deepEqual(resolveUniqueExerciseMention('Zapisz Ruch A oraz Ruch B.', distinct),
    { classification: 'UNRESOLVED', reason: 'MULTIPLE_EXERCISES' })
  assert.deepEqual(resolveUniqueExerciseMention('Zapisz Ruch A oraz Ruch B.', [...distinct].reverse()),
    { classification: 'UNRESOLVED', reason: 'MULTIPLE_EXERCISES' })
})

test('runtime-provided IDs and aliases require no code mapping', () => {
  const id = '8f66a250-5810-46fa-a67c-a041700f555a'
  assert.deepEqual(resolveUniqueExerciseMention('Sprawdź Dynamiczną etykietę.', [
    definition(id, 'Nazwa bieżąca', ['Dynamiczną etykietę']),
  ]), { classification: 'RESOLVED', exerciseId: id, authoritativeMention: 'Dynamiczną etykietę' })
})

test('display rename preserves identity through the existing authoritative alias contract', () => {
  const renamed = renameExerciseDefinition([definition('stable-id', 'Nazwa historyczna')], 'stable-id', 'Nazwa bieżąca', false)
  assert.deepEqual(resolveUniqueExerciseMention('Zapisz Nazwa historyczna.', renamed),
    { classification: 'RESOLVED', exerciseId: 'stable-id', authoritativeMention: 'Nazwa historyczna' })
  assert.deepEqual(resolveUniqueExerciseMention('Zapisz Nazwa bieżąca.', renamed),
    { classification: 'RESOLVED', exerciseId: 'stable-id', authoritativeMention: 'Nazwa bieżąca' })
})
