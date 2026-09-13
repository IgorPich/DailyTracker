import assert from 'node:assert/strict'
import { createServer } from 'vite'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

const server = await createServer({ server: { middlewareMode: true }, appType: 'custom', logLevel: 'error' })
try {
  const { weightChartData, windowFor } = await server.ssrLoadModule('/src/utils/calculations.ts')
  const entry = (date, weight) => ({ id: date, date, weight })
  const points = weightChartData([
    entry('2026-08-25', 200), entry('2026-08-26', 70), entry('2026-08-29', 80),
    entry('2026-08-30', undefined), entry('2026-09-01', 90), entry('2026-09-02', 300),
  ], '2026-09-01', '2026-09-01')
  assert.equal(points.length, 1)
  assert.equal(points[0].movingAverage, 80) // D-6 included; D-7 and future excluded.
  assert.equal(points[0].weight, 90)
  assert.equal(points[0].measurementCount, 3)
  assert.equal(points[0].windowFrom, '2026-08-26')
  assert.equal(points[0].windowTo, '2026-09-01')
  const full = Array.from({ length: 7 }, (_, index) => entry(`2026-09-0${index + 1}`, 80 + index))
  assert.equal(weightChartData(full).at(-1).measurementCount, 7)
  const missing = full.filter((_, index) => index !== 1 && index !== 3)
  assert.equal(weightChartData(missing).at(-1).measurementCount, 5)
  assert.equal(weightChartData(missing).at(-1).movingAverage, (80 + 82 + 84 + 85 + 86) / 5)
  assert.equal(weightChartData([entry('2026-01-01', 10), entry('2026-09-01', 90)]).at(-1).movingAverage, 90)
  assert.equal(weightChartData([entry('2026-09-01', undefined)]).length, 0)
  assert.equal(weightChartData([entry('2026-08-31', NaN), entry('2026-09-01', 90)]).at(-1).movingAverage, 90)
  assert.deepEqual(windowFor('2026-09-01', 7), { from: '2026-08-26', to: '2026-09-01' })
  assert.deepEqual(windowFor('2026-01-01', 7), { from: '2025-12-26', to: '2026-01-01' })
  assert.deepEqual(windowFor('2024-03-01', 7), { from: '2024-02-24', to: '2024-03-01' })
  assert.deepEqual(windowFor('2026-03-31', 7), { from: '2026-03-25', to: '2026-03-31' })
  const { WeightTooltip } = await server.ssrLoadModule('/src/components/ChartTooltip.tsx')
  const html = renderToStaticMarkup(createElement(WeightTooltip, { active: true, label: points[0].date, payload: [
    { dataKey: 'weight', value: points[0].weight, payload: points[0] },
    { dataKey: 'movingAverage', value: points[0].movingAverage, payload: points[0] },
  ] }))
  assert.match(html, /Pomiary: 3\/7/)
  assert.match(html, /Okres:/)
  assert.match(html, /26 sie/)
  assert.match(html, /1 wrz/)
  assert.match(html, /Masa dzienna/)
  assert.match(html, /Średnia 7 dni/)
  assert.match(html, /Brak pomiaru nie oznacza 0 kg/)
  console.log('PASS weight characterization: trailing calendar D-6..D, available finite observations, display range does not truncate lookback, month/year/leap/DST boundaries')
} finally { await server.close() }
