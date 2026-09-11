import { deepStrictEqual, notStrictEqual, strictEqual } from 'node:assert/strict'
import test from 'node:test'
import { insertTemplateExercise, moveItem, removeTemplateExercise, replaceTemplateExerciseDefinition, replaceTrainingTemplate } from '../src/templateOperations.ts'
import type { ExerciseDefinition, TemplateExercise, TrainingTemplate } from '../src/types.ts'

const exercise = (id: string): TemplateExercise => ({
  id,
  exerciseId: `canonical-${id}`,
  name: `Synthetic ${id}`,
  prescription: '3 × 8–12',
  defaultSets: 3,
  equipmentSensitive: id === 'exercise-b',
})

const template = (id: string, name = id): TrainingTemplate => ({
  id,
  code: 'A',
  name,
  exercises: [exercise(`${id}-exercise-a`), exercise(`${id}-exercise-b`)],
})

test('moves an item by shallow-copying the list and preserving item references', () => {
  const items = [exercise('exercise-a'), exercise('exercise-b'), exercise('exercise-c')]
  const result = moveItem(items, 2, 0)

  deepStrictEqual(result.map((item) => item.id), ['exercise-c', 'exercise-a', 'exercise-b'])
  strictEqual(result[0], items[2])
  notStrictEqual(result, items)
})

test('move returns the exact input list for invalid, equal and boundary indices', () => {
  const items = [exercise('exercise-a'), exercise('exercise-b')]

  strictEqual(moveItem(items, -1, 0), items)
  strictEqual(moveItem(items, 0, 2), items)
  strictEqual(moveItem(items, 0, 0), items)
})

test('remove template exercise deletes all exact duplicate ids and preserves order', () => {
  const first = exercise('duplicate')
  const untouched = exercise('untouched')
  const duplicate = exercise('duplicate')

  const result = removeTemplateExercise([first, untouched, duplicate], 'duplicate')

  deepStrictEqual(result, [untouched])
})

test('insert template exercise uses the current clamped one-based position contract', () => {
  const existing = [exercise('exercise-a'), exercise('exercise-b')]
  const inserted = exercise('inserted')

  deepStrictEqual(insertTemplateExercise(existing, inserted, -10).map((item) => item.id), ['inserted', 'exercise-a', 'exercise-b'])
  deepStrictEqual(insertTemplateExercise(existing, inserted, 2).map((item) => item.id), ['exercise-a', 'inserted', 'exercise-b'])
  deepStrictEqual(insertTemplateExercise(existing, inserted, 99).map((item) => item.id), ['exercise-a', 'exercise-b', 'inserted'])
  deepStrictEqual(insertTemplateExercise(existing, inserted, Number.NaN).map((item) => item.id), ['exercise-a', 'exercise-b', 'inserted'])
})

test('template replacement preserves order, replaces all duplicate ids and never appends a missing id', () => {
  const first = template('template-a', 'First duplicate')
  const untouched = template('template-b')
  const duplicate = template('template-a', 'Second duplicate')
  const replacement = template('template-a', 'Replacement')

  const result = replaceTrainingTemplate([first, untouched, duplicate], replacement)

  deepStrictEqual(result, [replacement, untouched, replacement])
  deepStrictEqual(replaceTrainingTemplate([untouched], replacement), [untouched])
})

test('exercise replacement changes only the selected slot reference', () => {
  const sharedDefinition: ExerciseDefinition = {
    id: 'definition-a',
    name: 'Synthetic shared definition',
    equipmentSensitive: false,
  }
  const replacementDefinition: ExerciseDefinition = {
    id: 'definition-b',
    name: 'Synthetic replacement definition',
    equipmentSensitive: true,
  }
  const templateB: TrainingTemplate = {
    id: 'template-b',
    code: 'B',
    name: 'Template B',
    exercises: [{ ...exercise('slot-b'), exerciseId: sharedDefinition.id, name: sharedDefinition.name }],
  }
  const templateD: TrainingTemplate = {
    id: 'template-d',
    code: 'D',
    name: 'Template D',
    exercises: [{ ...exercise('slot-d'), exerciseId: sharedDefinition.id, name: sharedDefinition.name }],
  }
  const historySnapshot = structuredClone([templateB, templateD])

  const nextTemplateD = {
    ...templateD,
    exercises: replaceTemplateExerciseDefinition(templateD.exercises, 'slot-d', replacementDefinition),
  }

  strictEqual(templateB.exercises[0].exerciseId, sharedDefinition.id)
  strictEqual(nextTemplateD.exercises[0].id, 'slot-d')
  strictEqual(nextTemplateD.exercises[0].exerciseId, replacementDefinition.id)
  strictEqual(nextTemplateD.exercises[0].name, replacementDefinition.name)
  strictEqual(nextTemplateD.exercises[0].equipmentSensitive, true)
  deepStrictEqual([templateB, templateD], historySnapshot)
  deepStrictEqual(sharedDefinition, {
    id: 'definition-a',
    name: 'Synthetic shared definition',
    equipmentSensitive: false,
  })
})
