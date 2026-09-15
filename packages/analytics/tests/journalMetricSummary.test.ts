import assert from 'node:assert/strict'
import test from 'node:test'
import { changeMetricTracking, journalConfiguration } from '@greekgod/core'
import { journalMetricSummary } from '../src/index.ts'
import { journalFixture } from '../../core/tests/fixtures/journal.fixture.ts'
test('inclusive coverage uses tracked days, not all days; preserved inactive values are not missing',()=>{
  const snapshot=journalFixture(), before=structuredClone(snapshot)
  snapshot.settings.journalConfiguration=changeMetricTracking(journalConfiguration(snapshot),'CHEST','2026-01-02',true)
  snapshot.dailyEntries.push({id:'day2',date:'2026-01-02',measurements:{CHEST:102}})
  const result=journalMetricSummary({snapshot,metricId:'CHEST',from:'2026-01-01',to:'2026-01-03'})
  assert.deepEqual(result.points.map(p=>p.status),['NOT_TRACKED','AVAILABLE','MISSING_DATA'])
  assert.equal(result.points[0].value,100)
  assert.equal(result.coverage,0.5);assert.equal(result.average,102);assert.equal(result.trackedDayCount,2)
  assert.equal(snapshot.dailyEntries[0].measurements!.CHEST,before.dailyEntries[0].measurements!.CHEST)
})
test('all inactive is NOT_TRACKED, not zero coverage or missing; tracked missing has no average',()=>{
  const snapshot=journalFixture()
  const inactive=journalMetricSummary({snapshot,metricId:'BICEPS',from:'2026-01-01',to:'2026-01-03'})
  assert.equal(inactive.status,'NOT_TRACKED');assert.equal(inactive.coverage,null);assert.equal(inactive.average,null);assert.equal(inactive.missingDayCount,0)
  const missing=journalMetricSummary({snapshot,metricId:'STEPS',from:'2026-01-01',to:'2026-01-03'})
  assert.equal(missing.status,'MISSING_DATA');assert.equal(missing.coverage,0);assert.equal(missing.average,null)
  assert.throws(()=>journalMetricSummary({snapshot,metricId:'WEIGHT',from:'2026-02-30',to:'2026-03-01'}))
})
