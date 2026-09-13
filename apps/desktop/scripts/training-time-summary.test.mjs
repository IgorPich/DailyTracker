import assert from 'node:assert/strict'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { createServer } from 'vite'

const server = await createServer({ server: { middlewareMode: true }, appType: 'custom', logLevel: 'error' })
try {
  const { trainingTimeRange, formatTrainingMinutes } = await server.ssrLoadModule('/src/utils/trainingTimePresentation.ts')
  const today = '2024-03-12'
  const custom = { from: '2023-12-17', to: '2024-02-29' }
  const workouts = [{ date: '2021-06-01' }, { date: '2020-02-30' }, { date: '2025-01-01' }]
  assert.deepEqual(trainingTimeRange('month', today, workouts, custom), { from: '2024-03-01', to: today })
  assert.deepEqual(trainingTimeRange('year', today, workouts, custom), { from: '2024-01-01', to: today })
  assert.deepEqual(trainingTimeRange('all', today, workouts, custom), { from: '2021-06-01', to: today })
  assert.deepEqual(trainingTimeRange('all', today, [], custom), { from: today, to: today })
  assert.deepEqual(trainingTimeRange('custom', today, workouts, custom), custom)
  assert.deepEqual(trainingTimeRange('month', '2024-01-01', [], custom), { from: '2024-01-01', to: '2024-01-01' })
  assert.equal(formatTrainingMinutes(65), '1 h 5 min')
  assert.equal(formatTrainingMinutes(10895), '181 h 35 min')
  assert.equal(formatTrainingMinutes(59.5), '1 h 0 min')
  assert.equal(formatTrainingMinutes(0.2), '< 1 min')
  assert.equal(formatTrainingMinutes(undefined), '—')
  const { TrainingTimeSummaryCard } = await server.ssrLoadModule('/src/components/TrainingTimeSummaryCard.tsx')
  const render = (records) => renderToStaticMarkup(createElement(TrainingTimeSummaryCard, { workouts: records, today }))
  const html = render([{ id: 'measured', date: today, duration: 65 }, { id: 'missing', date: today }])
  assert.match(html, /1 h 5 min/)
  assert.match(html, /1\/2 zapisanych treningów/)
  assert.match(html, /Niepełne dane/)
  assert.match(html, /Zapisane treningi/)
  for (const label of ['Ten miesiąc', 'Ten rok', 'Całość', 'Własny zakres']) assert.ok(html.includes(label))
  assert.doesNotMatch(html, /ukończonych treningów/)
  assert.match(render([]), /Brak zapisanych treningów/)
  assert.match(render([{ id: 'zero', date: today, duration: 0 }]), /Brak dostępnych danych o czasie/)
  assert.doesNotMatch(render([{ id: 'zero', date: today, duration: 0 }]), /<dd>0 min<\/dd>/)
  console.log('Training time presentation: PASS (presets, custom range, formatting, SSR coverage and empty states)')
} finally {
  await server.close()
}
