import { useEffect, useMemo, useRef, useState } from 'react'
import { FakeCompanionModel } from '@greekgod/companion'
import { createMemoryApplication, memoryStatus, type MemoryCandidate, type MemoryDraft, type MemoryItem, type MemoryScope } from '@greekgod/companion/memory'
import { useApp } from '../context/AppContext'
import { companionMemoryRepository, supportsCompanionMemoryPersistence } from '../services/companionMemoryStorage'
import { humanCoachRepository } from '../services/humanCoachStorage'
import { PageHeader } from '../components/PageHeader'

export function CompanionMemory() {
  const { data } = useApp()
  const dataRef = useRef(data); dataRef.current = data
  const service = useMemo(() => createMemoryApplication(companionMemoryRepository, async () => ({
    exerciseIds: dataRef.current.exerciseLibrary.map((item) => item.id),
    coachItemIds: (await humanCoachRepository.read()).items.map((item) => item.id),
  }), () => new Date().toISOString(), () => crypto.randomUUID()), [])
  const [items, setItems] = useState<MemoryItem[]>([])
  const [coachItems, setCoachItems] = useState<{ id: string; kind: string }[]>([])
  const [candidate, setCandidate] = useState<MemoryCandidate>()
  const [kind, setKind] = useState<MemoryDraft['content']['kind']>('SUMMARY_STYLE')
  const [style, setStyle] = useState<'SHORT' | 'DETAILED'>('SHORT')
  const [exerciseId, setExerciseId] = useState('')
  const [coachId, setCoachId] = useState('')
  const [expiry, setExpiry] = useState('')
  const [error, setError] = useState('')
  const [ready, setReady] = useState(false)
  const [busy, setBusy] = useState(false)
  const busyRef = useRef(false)
  const refresh = async () => {
    setItems((await service.list()).items)
    setCoachItems((await humanCoachRepository.read()).items.map(({ id, kind }) => ({ id, kind })))
    setReady(true)
  }
  useEffect(() => { void refresh().catch((e) => setError(String(e))) }, [service])
  const run = async (operation: () => Promise<unknown>) => {
    if (busyRef.current) return
    busyRef.current = true; setBusy(true); setError('')
    try { await operation(); await refresh() }
    catch (e) { setError(`${String(e)}. Nie ponawiaj automatycznie; odśwież zapisany stan przed kolejną próbą.`); setReady(false) }
    finally { busyRef.current = false; setBusy(false) }
  }
  const scope: MemoryScope = kind === 'HUMAN_COACH_REFERENCE' ? { kind: 'HUMAN_COACH_CONTEXT', id: coachId }
    : exerciseId ? { kind: 'EXERCISE', id: exerciseId } : { kind: 'GLOBAL' }
  const draft = (): MemoryDraft => ({ content: kind === 'SUMMARY_STYLE' ? { kind, value: style } : { kind, value: coachId },
    scope, expiresAt: expiry ? new Date(expiry).toISOString() : null })
  const asOf = new Date().toISOString()
  const sourceLabel = (item: MemoryItem) => item.source === 'USER_EXPLICIT' ? 'Jawnie dodane przez użytkownika' : item.source === 'HUMAN_COACH' ? 'Referencja HumanCoach, przyjęta przez użytkownika' : 'Sugestia fake, przyjęta przez użytkownika'
  return <div className="page human-coach-page">
    <PageHeader eyebrow="KONTEKST PC-LOCAL" title="Pamięć Companion" description="Tylko jawnie przyjęte preferencje i referencje. To nie historia rozmów ani polecenia dla aplikacji." />
    {!supportsCompanionMemoryPersistence && <p>Podgląd przeglądarkowy: brak trwałego zapisu pamięci. Wymagana aplikacja Desktop.</p>}
    {error && <p role="alert">{error}</p>}
    <button type="button" className="button button--ghost" disabled={busy} onClick={() => void run(refresh)}>Odśwież zapisany stan</button>
    <form className="human-coach-form" onSubmit={(event) => event.preventDefault()}>
      <fieldset disabled={busy || !ready || !!candidate}>
        <legend>Dodaj świadomie ustrukturyzowaną pamięć</legend>
        <label>Rodzaj<select value={kind} onChange={(event) => setKind(event.target.value as typeof kind)}>
          <option value="SUMMARY_STYLE">Długość podsumowania</option><option value="HUMAN_COACH_REFERENCE">Referencja do kontekstu trenera</option>
        </select></label>
        {kind === 'SUMMARY_STYLE' ? <>
          <label>Preferencja<select value={style} onChange={(event) => setStyle(event.target.value as typeof style)}><option value="SHORT">Krótkie</option><option value="DETAILED">Szczegółowe</option></select></label>
          <label>Zakres<select value={exerciseId} onChange={(event) => setExerciseId(event.target.value)}><option value="">Globalny</option>
            {data.exerciseLibrary.map((item, index) => <option key={`${item.id}:${index}`} value={item.id}>{item.name} · pozycja {index + 1}</option>)}</select></label>
        </> : <label>Dokładny element HumanCoach<select value={coachId} onChange={(event) => setCoachId(event.target.value)}><option value="">Wybierz referencję</option>
          {coachItems.map((item) => <option key={item.id} value={item.id}>{item.kind} · {item.id}</option>)}</select></label>}
        <label>Ważne do (opcjonalnie, czas lokalny)<input type="datetime-local" value={expiry} onChange={(event) => setExpiry(event.target.value)} /></label>
        <button type="button" className="button button--primary" disabled={!supportsCompanionMemoryPersistence} onClick={() => void run(() => service.addExplicit(draft()))}>Zapisz jawną pamięć</button>
        <button type="button" className="button button--ghost" disabled={kind !== 'SUMMARY_STYLE' || !!exerciseId} onClick={() => void run(async () => {
          setCandidate(await service.propose(new FakeCompanionModel(draft())))
        })}>Przygotuj kandydata fake (bez zapisu)</button>
      </fieldset>
    </form>
    {candidate && <section className="human-coach-item"><h2>Kandydat — nie jest aktywną pamięcią</h2>
      <p>Preferencja: {candidate.draft.content.value} · GLOBAL · expiry: {candidate.draft.expiresAt ?? 'brak'}</p>
      <p>Źródło: COMPANION_SUGGESTED. Konfiguracja fake, bez parsowania języka.</p>
      <button type="button" className="button button--primary" disabled={busy || !ready || !supportsCompanionMemoryPersistence} onClick={() => void run(async () => {
        const accepted = candidate; setCandidate(undefined); await service.accept(accepted)
      })}>Przyjmij do pamięci</button>
      <button type="button" className="button button--ghost" disabled={busy} onClick={() => { service.reject(candidate); setCandidate(undefined) }}>Odrzuć bez zapisu</button>
    </section>}
    <h2>Zapisana pamięć ({items.length}/100)</h2>
    {items.map((item) => <section className="human-coach-item" key={item.id}>
      <h3>{item.content.kind === 'SUMMARY_STYLE' ? `Podsumowania: ${item.content.value === 'SHORT' ? 'krótkie' : 'szczegółowe'}` : `Referencja HumanCoach: ${item.content.value}`}</h3>
      <p>{memoryStatus(item, asOf)} · {item.scope.kind}{'id' in item.scope ? ` · ${item.scope.id}` : ''}</p>
      <p>{sourceLabel(item)} · utworzono: {item.createdAt} · ważne do: {item.expiresAt ?? 'bez terminu'}</p>
      <details><summary>Pochodzenie</summary><p>{JSON.stringify(item.provenance)} · ID: {item.id}</p></details>
      <button type="button" className="button button--ghost" disabled={busy || !ready || item.status === 'ARCHIVED' || !supportsCompanionMemoryPersistence} onClick={() => void run(() => service.archive(item.id))}>Archiwizuj</button>
    </section>)}
    <p>Wygasłe i archiwalne elementy pozostają do inspekcji. Nie są przekazywane do kontekstu modelu.</p>
  </div>
}
