import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createServer } from 'vite'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

const server = await createServer({server:{middlewareMode:true},appType:'custom',logLevel:'error'})
try {
  const core=await server.ssrLoadModule('@greekgod/core')
  const {createInitialData,normalizeData}=await server.ssrLoadModule('/src/utils/storage.ts')
  const {journalReportingSnapshot,companionJournalEvidence}=await server.ssrLoadModule('/src/adapters/journalReporting.ts')
  const {JournalFacts}=await server.ssrLoadModule('/src/components/JournalFacts.tsx')
  const {weightChartData}=await server.ssrLoadModule('/src/utils/calculations.ts')
  const {createReadOnlyCompanion,userDialogueInput}=await server.ssrLoadModule('@greekgod/companion/readonly')
  const data=createInitialData()
  data.dailyEntries=[{id:'synthetic-one',date:'2026-01-01',weight:80,measurements:{CHEST:101,BICEPS:36}}, {id:'synthetic-two',date:'2026-01-02',weight:82}]
  const before=structuredClone(data)
  assert.deepEqual(weightChartData(journalReportingSnapshot(data,'2026-01-02').dailyEntries),weightChartData(data.dailyEntries))
  data.settings.journalConfiguration=core.changeMetricTracking(core.journalConfiguration(data),'WEIGHT','2026-01-02',false)
  assert.deepEqual(weightChartData(journalReportingSnapshot(data,'2026-01-02').dailyEntries),[])
  assert.deepEqual(data.dailyEntries,before.dailyEntries)
  assert.deepEqual(JSON.parse(JSON.stringify(normalizeData(JSON.parse(JSON.stringify(data))))),JSON.parse(JSON.stringify(data)))
  const html=renderToStaticMarkup(createElement(JournalFacts,{data,from:'2026-01-02',to:'2026-01-02'}))
  assert.match(html,/Nieśledzona w tym okresie/);assert.match(html,/Klatka piersiowa/);assert.match(html,/Biceps/)
  const evidence=companionJournalEvidence(data,'2026-01-02','2026-01-02')
  const weight=evidence.find(item=>JSON.parse(item.text).metricId==='WEIGHT')
  assert.equal(JSON.parse(weight.text).status,'NOT_TRACKED')
  assert.equal(JSON.parse(weight.text).coverage,null)
  const snapshot=structuredClone(data)
  const runtime=createReadOnlyCompanion({readEvidence:async()=>evidence},{propose:async request=>{
    assert.deepEqual(request.evidence,evidence)
    return {message:'Masa nie jest śledzona w tym okresie.',evidenceIds:[weight.id]}
  }})
  assert.equal((await runtime.dialogue(userDialogueInput('Podsumuj metryki'))).status,'MESSAGE')
  assert.deepEqual(data,snapshot)
  const desktop=readFileSync('src/pages/Journal.tsx','utf8'), mobile=readFileSync('../mobile/src/pages/JournalPage.tsx','utf8')
  for(const source of [desktop,mobile]) {
    assert.match(source,/activeJournalMetrics/);assert.match(source,/journalMeasurementChanges/)
    assert.match(source,/metric\.id/);assert.doesNotMatch(source,/applyJournalNumericDraft|saveDailyEntry\(/)
  }
  const settings=readFileSync('src/pages/JournalSettings.tsx','utf8')
  assert.match(settings,/kind:'CONFIGURATION'/);assert.match(settings,/baseline:journalConfigurationBaseline/)
  assert.match(settings,/Anuluj/);assert.match(settings,/changeMetricTracking/)
  console.log('PASS Journal: normalized round-trip, unchanged 7-day math, NOT_TRACKED SSR/evidence, read-only Companion and generic Desktop/Mobile wiring')
} finally {await server.close()}
