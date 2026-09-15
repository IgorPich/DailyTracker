import assert from 'node:assert/strict'
import test from 'node:test'
import { applyDailyEntryEdit, type DailyEntry, type DailyEntryEdit } from '@greekgod/core'
import { INITIAL_MOBILE_DATA } from '../src/data/initialData.ts'
import { persistDailyEntryEdit } from '../src/services/dailyEntryPersistence.ts'
import type { MobileSnapshot, MobileStore } from '../src/services/mobileStore.ts'

const baseline: DailyEntry = { id: 'synthetic-day', date: '2026-01-15', weight: 80, waist: 90 }
const plan = (): DailyEntryEdit => ({ date: baseline.date,newId: 'unused',baseline: structuredClone(baseline),changes: [{ field:'weight',action:'SET',value:79 }] })
const snapshot = (): MobileSnapshot => ({ data:{ ...structuredClone(INITIAL_MOBILE_DATA),dailyEntries:[structuredClone(baseline)] },revision:10,appliedOperations:0,pendingChanges:0,deviceId:'fixture',probe:{databasePath:'fixture',sqliteVersion:'test',schemaVersion:8,journalMode:'test'} })

test('fresh historical fields, unknown measurements and inactive values survive a weight edit', () => {
  const data = snapshot().data
  const fresh = { ...baseline, measurements:{ CHEST:100,BICEPS:35,FUTURE_METRIC:42 }, futureField:{ nested:['preserve'] }, note:'new note' }
  data.dailyEntries = [fresh]
  const before = structuredClone(data)
  const saved = applyDailyEntryEdit(data,plan())
  assert.deepEqual(saved.dailyEntries,[{...fresh,weight:79}])
  assert.deepEqual(data,before)
  const clear = plan(); clear.changes = [{field:'waist',action:'CLEAR'}]
  const cleared = applyDailyEntryEdit(data,clear).dailyEntries[0]
  assert.equal(cleared.waist,undefined)
  assert.equal(cleared.weight,80)
  assert.deepEqual((cleared as typeof fresh).measurements,fresh.measurements)
  data.dailyEntries = [{...fresh,weight:81}]
  assert.throws(() => applyDailyEntryEdit(data,plan()),/STALE/)
})

test('new-day collision preserves fresh ID/unknown fields; same-field collision and deletion are stale', () => {
  const request = plan(); request.baseline = undefined; request.changes = [{field:'note',action:'SET',value:'new note'}]
  const data = snapshot().data
  assert.equal(applyDailyEntryEdit(data,request).dailyEntries.length,1)
  assert.equal(applyDailyEntryEdit(data,request).dailyEntries[0].id,baseline.id)
  request.changes = [{field:'weight',action:'SET',value:79}]
  assert.throws(() => applyDailyEntryEdit(data,request),/STALE/)
  data.dailyEntries = []
  assert.throws(() => applyDailyEntryEdit(data,plan()),/STALE/)
})

test('CAS retry reloads and overlays explicit fields, never the stale whole entry', async () => {
  for (const sameField of [false,true]) {
    let current = snapshot(), saves = 0
    const store: MobileStore = { initialize:async()=>current,load:async()=>structuredClone(current),save:async(data,revision)=>{
      saves++
      if (saves===1) {
        current.revision++
        current.data.dailyEntries = [{...baseline,...(sameField?{weight:81}:{}),measurements:{CHEST:100,BICEPS:35}} as DailyEntry]
        throw {kind:'revision-conflict'}
      }
      assert.equal(revision,current.revision)
      current={...current,data,revision:revision+1}; return current
    } }
    const result = await persistDailyEntryEdit(store,plan())
    assert.equal(result.status,sameField?'STALE':'APPLIED')
    assert.equal(saves,sameField?1:2)
    assert.equal(current.data.dailyEntries[0].weight,sameField?81:79)
    assert.deepEqual((current.data.dailyEntries[0] as DailyEntry & {measurements:unknown}).measurements,{CHEST:100,BICEPS:35})
  }
})

test('unconfirmed write never publishes APPLIED or automatically retries', async () => {
  let writes=0
  const current = snapshot()
  const store: MobileStore = {initialize:async()=>current,load:async()=>current,save:async()=>{writes++;throw new Error('lost acknowledgement')}}
  assert.equal((await persistDailyEntryEdit(store,plan())).status,'INDETERMINATE')
  assert.equal(writes,1)
})
