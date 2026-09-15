import assert from 'node:assert/strict'
import test from 'node:test'
import { activeJournalMetrics, applyJournalConfiguration, changeMetricTracking, journalConfiguration, journalConfigurationBaseline, measurementValue, metricIsTracked, validateJournalConfiguration } from '../src/journalMetrics.ts'
import { journalMeasurementChanges, journalMeasurementDraft } from '../src/journalDraft.ts'
import { applyDailyEntryEdit } from '../src/dailyEntryEdit.ts'
import { journalFixture } from './fixtures/journal.fixture.ts'

test('upgrade derives legacy defaults without writing data; draft cancel/reorder is detached', () => {
  const data = journalFixture(), before = structuredClone(data), config = journalConfiguration(data)
  assert.deepEqual(activeJournalMetrics(config,'2026-01-01').map(m=>m.id), ['WEIGHT','WAIST','CALORIES','PROTEIN','CARBS','FAT','STEPS'])
  config.metrics.reverse()
  assert.deepEqual(data,before)
  const saved = applyJournalConfiguration(data,{baseline:journalConfigurationBaseline(data),configuration:config})
  assert.deepEqual(saved.dailyEntries,before.dailyEntries)
  assert.deepEqual(saved.templates,before.templates)
  assert.deepEqual(journalConfiguration(saved).metrics.map(m=>m.metricId),config.metrics.map(m=>m.metricId))
})
test('disable and re-enable retain exact inclusive tracking periods and all historical values', () => {
  const data = journalFixture()
  let config = changeMetricTracking(journalConfiguration(data),'WEIGHT','2026-01-02',false)
  config = changeMetricTracking(config,'WEIGHT','2026-01-04',true)
  assert.deepEqual(['01','02','03','04'].map(day=>metricIsTracked(config,'WEIGHT',`2026-01-${day}`)),[true,false,false,true])
  assert.throws(()=>changeMetricTracking(config,'WEIGHT','2026-01-03',true),/later tracking/)
  assert.throws(()=>changeMetricTracking(config,'WEIGHT','2026-02-30',true))
  const replacement = changeMetricTracking(config,'WEIGHT','2026-01-04',false)
  assert.equal(replacement.metrics[0].transitions.length,2)
  assert.equal(measurementValue(data.dailyEntries[0],'WEIGHT'),80)
})
test('configuration fresh baseline preserves unrelated updates and rejects concurrent configuration', () => {
  const data = journalFixture(), plan = {baseline:journalConfigurationBaseline(data),configuration:changeMetricTracking(journalConfiguration(data),'CHEST','2026-01-02',true)}
  const fresh = structuredClone(data); fresh.settings.calorieTarget++; fresh.dailyEntries[0].weight=81
  const saved = applyJournalConfiguration(fresh,plan)
  assert.equal(saved.settings.calorieTarget,fresh.settings.calorieTarget)
  assert.equal(saved.dailyEntries[0].weight,81)
  assert.throws(()=>applyJournalConfiguration(saved,plan),/STALE_CONFIGURATION/)
  const invalid = journalConfiguration(data); invalid.metrics[1]=structuredClone(invalid.metrics[0])
  assert.throws(()=>validateJournalConfiguration(invalid))
})
test('single normalized legacy source, canonical units, comma decimals and explicit clear', () => {
  const data = journalFixture(), entry=data.dailyEntries[0]
  entry.measurements!.WEIGHT=999
  assert.equal(measurementValue(entry,'WEIGHT'),80)
  const draft = journalMeasurementDraft(entry); draft.WEIGHT='81,25';draft.CHEST='101,5';draft.BICEPS=''
  const changes=journalMeasurementChanges(draft,['WEIGHT','CHEST','BICEPS'])
  const saved=applyDailyEntryEdit(data,{date:entry.date,newId:'unused',baseline:structuredClone(entry),changes:[],metricChanges:changes})
  assert.equal(saved.dailyEntries[0].id,entry.id)
  assert.equal(saved.dailyEntries[0].weight,81.25)
  assert.deepEqual(saved.dailyEntries[0].measurements,{CHEST:101.5,FUTURE_METRIC:12,WEIGHT:999})
  assert.equal(saved.dailyEntries[0].waist,90)
  assert.throws(()=>journalMeasurementChanges({STEPS:'1,5'},['STEPS']))
  assert.throws(()=>journalMeasurementChanges({CHEST:'NaN'},['CHEST']))
  assert.throws(()=>journalMeasurementChanges({CHEST:'-1'},['CHEST']))
})
test('generic metric same-field stale; unrelated map changes survive; omitted means unchanged', () => {
  const data=journalFixture(), baseline=structuredClone(data.dailyEntries[0])
  const plan={date:baseline.date,newId:'unused',baseline,changes:[],metricChanges:[{metricId:'CHEST',action:'SET' as const,value:102}]}
  data.dailyEntries[0].measurements!.BICEPS=37
  assert.equal(applyDailyEntryEdit(data,plan).dailyEntries[0].measurements!.BICEPS,37)
  data.dailyEntries[0].measurements!.CHEST=103
  assert.throws(()=>applyDailyEntryEdit(data,plan),/STALE/)
  assert.equal(applyDailyEntryEdit(data,{...plan,metricChanges:[]}),data)
})
