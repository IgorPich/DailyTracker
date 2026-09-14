import { useEffect, useState } from 'react'
import { FakeCompanionModel } from '@greekgod/companion'
import { applicationEventTrigger, createReadOnlyCompanion, spontaneousCompanionTrigger, userDialogueInput, type CompanionReadOnlyRequest } from '@greekgod/companion/readonly'
import { observeReadOnlyReaction, reactionSnapshot } from '../services/companionReactions'
import { PageHeader } from '../components/PageHeader'

export function CompanionReactions() {
  const [reducedMotion, setReducedMotion] = useState(false)
  const [state, setState] = useState(() => reactionSnapshot(false))
  const [outcome, setOutcome] = useState('')
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    setState(reactionSnapshot(reducedMotion))
    const timer = window.setInterval(() => setState(reactionSnapshot(reducedMotion)), 250)
    return () => window.clearInterval(timer)
  }, [reducedMotion])
  const simulate = async (source: 'USER_DIALOGUE' | 'SPONTANEOUS' | 'APPLICATION_EVENT') => {
    setBusy(true)
    try {
      const runtime = createReadOnlyCompanion({ readEvidence: async () => [] },
        new FakeCompanionModel<CompanionReadOnlyRequest>({ message: 'Syntetyczna informacja — bez zapisu danych.', evidenceIds: [] }))
      const result = source === 'USER_DIALOGUE' ? await runtime.dialogue(userDialogueInput('Syntetyczne pytanie'))
        : source === 'SPONTANEOUS' ? await runtime.spontaneous(spontaneousCompanionTrigger())
          : await runtime.applicationEvent(applicationEventTrigger('WORKOUT_SAVED'))
      setOutcome(observeReadOnlyReaction(source, result.status)); setState(reactionSnapshot(reducedMotion))
    } finally { setBusy(false) }
  }
  return <div className="page human-coach-page">
    <PageHeader eyebrow="DIAGNOSTYKA PREZENTACJI" title="Reakcje Companion" description="Karta testowa, nie finalny avatar. Wyłącznie stan w pamięci procesu." />
    <label><input type="checkbox" checked={reducedMotion} onChange={(event) => setReducedMotion(event.target.checked)} /> Ograniczony ruch</label>
    <section className="human-coach-item" aria-live="polite">
      <h2>{state.presentation.semanticReaction}</h2>
      <p>{state.presentation.reducedMotion ? 'Prezentacja statyczna / ograniczony ruch' : 'Placeholder tekstowy — bez assetów i animacji'}</p>
      <p>Kolejka: {state.queuedCount} · stłumione: {state.suppressedCount} · wygasłe w kolejce: {state.expiredCount}</p>
      <p>Ostatnia próba: {outcome || 'brak'} · polityka v{state.policyVersion}</p>
      <details><summary>Stan techniczny</summary><p>Token: {state.presentation.token ?? 'brak'} · początek: {state.presentation.startedAt ?? 'brak'}</p></details>
    </section>
    <button type="button" className="button button--ghost" disabled={busy} onClick={() => void simulate('USER_DIALOGUE')}>Dialog fake</button>
    <button type="button" className="button button--ghost" disabled={busy} onClick={() => void simulate('SPONTANEOUS')}>Trigger spontaniczny fake</button>
    <button type="button" className="button button--ghost" disabled={busy} onClick={() => void simulate('APPLICATION_EVENT')}>Zapis treningu — symulacja bez zapisu</button>
    <p>Priorytet i timing pochodzą wyłącznie z polityki aplikacji. Model zwraca tylko informację. Rzeczywisty wynik jawnej komendy może również zaktualizować tę kartę.</p>
  </div>
}
