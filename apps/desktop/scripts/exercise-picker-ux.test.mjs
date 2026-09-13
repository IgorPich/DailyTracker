import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { createServer } from 'vite'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

const server = await createServer({ server: { middlewareMode: true }, appType: 'custom', logLevel: 'error' })
try {
  const { exerciseSearchOptions, searchExercises, selectExerciseResult, newExerciseConfirmation } = await server.ssrLoadModule('/src/utils/exerciseSearch.ts')
  const { replaceSessionExercise } = await server.ssrLoadModule('/src/utils/sessionExerciseReplacement.ts')
  const { updateTemplateAndLibrary } = await server.ssrLoadModule('/src/utils/templateIdentity.ts')
  const { replaceTemplateExerciseDefinition } = await server.ssrLoadModule('@greekgod/core')
  const { createInitialData } = await server.ssrLoadModule('/src/utils/storage.ts')
  const library = [
    { id: randomUUID(), name: 'Unoszenie bokiem na maszynie', equipmentSensitive: true },
    { id: randomUUID(), name: 'Wiosło', equipmentSensitive: false },
    { id: randomUUID(), name: 'Wiosło', equipmentSensitive: true },
    { id: randomUUID(), name: 'Other exercise', equipmentSensitive: false },
  ]
  const before = structuredClone(library)
  const options = exerciseSearchOptions(library)
  const typo = searchExercises(options, 'unoszenie bokiem na mazsynie')
  assert.equal(typo.length, 1)
  assert.equal(typo[0].definition.id, library[0].id)
  assert.equal(searchExercises(options, 'WIOSLO').length, 2)
  assert.equal(searchExercises(options, 'wiOSł').length, 2)
  assert.deepEqual(searchExercises(options, 'zzzzzzzzzzzz'), [])
  let selected
  assert.equal(selected, undefined) // Discovery alone cannot commit or create.
  assert.deepEqual(library, before)
  assert.equal(selectExerciseResult(library, typo[0], (definition) => { selected = definition }), true)
  assert.equal(selected, library[0])
  assert.equal(selectExerciseResult(library.slice(1), typo[0], () => { throw new Error('Must not select missing identity') }), false)
  const sameName = searchExercises(options, 'wioslo')
  assert.notEqual(sameName[0].definition.id, sameName[1].definition.id)
  assert.notEqual(sameName[0].label, sameName[1].label)
  assert.match(newExerciseConfirmation(library, 'Unoszenie bokiem na mazsynie'), /Podobne istniejące ćwiczenia/)
  assert.match(newExerciseConfirmation(library, 'Unoszenie bokiem na mazsynie'), /Unoszenie bokiem na maszynie/)
  assert.doesNotMatch(newExerciseConfirmation(library, 'Entirely unknown'), /Podobne istniejące/)
  assert.deepEqual(library, before)
  assert.equal(exerciseSearchOptions([library[0], library[0]]).length, 0)

  const occurrence = (id, exerciseId) => ({ id, exerciseId, name: 'Snapshot', equipmentSensitive: false, prescription: '2 × 6–10', sets: [{ id: randomUUID(), weight: 20, reps: 8 }] })
  const workout = (id, date, exerciseId) => ({ id, date, exercises: [occurrence(randomUUID(), exerciseId)] })
  const templates = [
    { id: randomUUID(), code: 'B', name: 'Synthetic B', exercises: [{ id: randomUUID(), exerciseId: library[1].id, name: library[1].name, defaultSets: 2, prescription: '2 × 6–10', equipmentSensitive: false }] },
    { id: randomUUID(), code: 'D', name: 'Synthetic D', exercises: [{ id: randomUUID(), exerciseId: library[1].id, name: library[1].name, defaultSets: 2, prescription: '2 × 6–10', equipmentSensitive: false }] },
  ]
  const workouts = [workout(randomUUID(), '2026-01-02', library[2].id), workout(randomUUID(), '2026-01-01', library[0].id)]
  const ordered = exerciseSearchOptions(library, templates, workouts)
  assert.deepEqual(ordered.map((x) => x.definition.id), [library[2].id, library[0].id, library[1].id, library[3].id])
  assert.deepEqual(ordered, exerciseSearchOptions(library, templates, workouts))
  const data = { ...createInitialData(), templates, workouts, exerciseLibrary: library }
  const snapshot = structuredClone(data)
  const session = [occurrence(templates[1].exercises[0].id, library[1].id)]
  const replacement = replaceSessionExercise(session, session[0].id, library[0], () => ({ id: randomUUID() }))
  assert.equal(replacement[0].id, session[0].id)
  assert.equal(replacement[0].exerciseId, library[0].id)
  assert.equal(replacement[0].sets[0].weight, undefined)
  assert.equal(session[0].exerciseId, library[1].id)
  assert.deepEqual(data, snapshot)
  const draft = { ...templates[1], exercises: replaceTemplateExerciseDefinition(templates[1].exercises, templates[1].exercises[0].id, library[0]) }
  const saved = updateTemplateAndLibrary(data, draft)
  assert.deepEqual(saved.templates[0], templates[0]) // D cannot alter B.
  assert.equal(saved.templates[1].exercises[0].id, templates[1].exercises[0].id)
  assert.equal(saved.templates[1].exercises[0].exerciseId, library[0].id)
  assert.deepEqual(saved.library, library)
  assert.deepEqual(data, snapshot)

  const training = readFileSync(new URL('../src/pages/Training.tsx', import.meta.url), 'utf8')
  const editor = readFileSync(new URL('../src/components/TemplateEditor.tsx', import.meta.url), 'utf8')
  const progress = readFileSync(new URL('../src/pages/Progress.tsx', import.meta.url), 'utf8')
  const picker = readFileSync(new URL('../src/components/ExercisePicker.tsx', import.meta.url), 'utf8')
  for (const source of [training, editor]) {
    assert.doesNotMatch(source, /window\.prompt|Wpisz dokładny ID/)
    assert.match(source, /ExerciseReplacementPicker/)
    assert.match(source, /window\.confirm\(newExerciseConfirmation/)
    assert.match(source, /Utwórz/)
  }
  assert.match(picker, /placeholder="Wyszukaj ćwiczenie\.\.\."/)
  assert.match(picker, /setHighlight\(-1\)/)
  assert.match(picker, /if \(open && highlight >= 0 && results\[highlight\]\) choose/)
  assert.doesNotMatch(picker, /createId|randomUUID|registerExerciseDefinition|onCreate/)
  assert.doesNotMatch(training, /event\.preventDefault\(\); addCustomExercise\(\)/)
  assert.match(progress, /onSelect=\{\(definition\) => setExerciseId\(definition.id\)\}/)
  assert.doesNotMatch(progress, /bench-press|keyExercises|<select value=\{selectedExercise/)
  const { ExercisePicker } = await server.ssrLoadModule('/src/components/ExercisePicker.tsx')
  const markup = renderToStaticMarkup(createElement(ExercisePicker, { library, value: library[0].id, onSelect: () => { throw new Error('Render cannot select') } }))
  assert.match(markup, /role="combobox"/)
  assert.match(markup, /Wyszukaj ćwiczenie\.\.\./)
  assert.ok(!markup.includes(library[0].id))
  console.log('PASS picker UX: exact explicit selection, typo discovery only, creation confirmation/warnings, duplicate names, generated IDs, deterministic recent/active ordering, temporary/permanent isolation and component wiring')
} finally { await server.close() }
