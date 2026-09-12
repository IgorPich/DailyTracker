import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { createHumanCoach, linkedExerciseIds, type HumanCoachContext, type HumanCoachItem, type TargetSpecification } from '@greekgod/human-coach'
import { PageHeader } from '../components/PageHeader'
import { useApp } from '../context/AppContext'
import { humanCoachRepository } from '../services/humanCoachStorage'

const kindLabels = { NOTE: 'Notatka źródłowa', TASK: 'Zadanie', TARGET: 'Cel', DECISION: 'Decyzja' } as const
const taskLabels = { OPEN: 'Otwarte', COMPLETED: 'Ukończone', CANCELLED: 'Anulowane' } as const

export function HumanCoach() {
  const { data } = useApp()
  const library = useRef(data.exerciseLibrary)
  library.current = data.exerciseLibrary
  const service = useMemo(() => createHumanCoach(humanCoachRepository, {
    readExerciseIds: () => library.current.map((definition) => definition.id),
  }), [])
  const [context, setContext] = useState<HumanCoachContext>()
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const busyRef = useRef(false)
  const [kind, setKind] = useState<HumanCoachItem['kind']>('NOTE')
  const [title, setTitle] = useState('')
  const [text, setText] = useState('')
  const [sourceNoteId, setSourceNoteId] = useState('')
  const [sourceReference, setSourceReference] = useState('')
  const [noteSource, setNoteSource] = useState<'MANUAL' | 'TRAINER_TEXT'>('MANUAL')
  const [exerciseId, setExerciseId] = useState('')
  const [targetType, setTargetType] = useState<TargetSpecification['type']>('REP_RANGE')
  const [value, setValue] = useState('')
  const [minimum, setMinimum] = useState('')
  const [maximum, setMaximum] = useState('')

  const run = async (operation: () => Promise<HumanCoachContext>) => {
    if (busyRef.current) return false
    busyRef.current = true
    setBusy(true)
    setError('')
    try { setContext(await operation()); return true }
    catch (error) { setError(error instanceof Error ? error.message : 'Nie udało się zapisać kontekstu'); return false }
    finally { busyRef.current = false; setBusy(false) }
  }
  useEffect(() => { void run(() => service.listContext()) }, [service])

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    const command = {
      id: crypto.randomUUID(),
      provenance: {
        sourceType: kind === 'NOTE' ? noteSource : sourceNoteId ? 'TRAINER_TEXT' as const : 'MANUAL' as const,
        createdAt: new Date().toISOString(),
        ...(kind !== 'NOTE' && sourceNoteId ? { sourceNoteId } : {}),
        ...(sourceReference.trim() ? { sourceReference } : {}),
      },
    }
    const saved = await run(() => {
      if (kind === 'NOTE') return service.createCoachNote({ ...command, text })
      if (kind === 'TASK') return service.createCoachTask({ ...command, title, ...(text.trim() ? { description: text } : {}), exerciseIds: exerciseId ? [exerciseId] : [] })
      if (kind === 'DECISION') return service.createCoachDecision({ ...command, text, exerciseIds: exerciseId ? [exerciseId] : [] })
      const specification: TargetSpecification = targetType === 'REP_RANGE'
        ? { type: 'REP_RANGE', scope: 'EXERCISE', exerciseId, min: Number(minimum), max: Number(maximum), unit: 'reps' }
        : targetType === 'BODYWEIGHT'
          ? { type: 'BODYWEIGHT', scope: 'PERSON', value: Number(value), unit: 'kg' }
          : { type: 'WAIST', scope: 'PERSON', value: Number(value), unit: 'cm' }
      return service.createCoachTarget({ ...command, title, specification })
    })
    if (saved) { setTitle(''); setText(''); setValue(''); setMinimum(''); setMaximum('') }
  }
  const notes = context?.items.filter((item) => item.kind === 'NOTE') ?? []
  const exerciseLabel = (id: string) => {
    const matches = data.exerciseLibrary.filter((definition) => definition.id === id)
    return matches.length === 1 ? `${matches[0].name} (${id})` : `Nieznane lub niejednoznaczne ID: ${id}`
  }

  return <div className="page human-coach-page">
    <PageHeader eyebrow="ZEWNĘTRZNY TRENER" title="Kontekst trenera" description="Zapis ustaleń z trenerem lub zewnętrznym ChatGPT. Tylko ten komputer; bez automatycznej interpretacji i synchronizacji." />
    <p>Nowe wpisy są szkicami. Zatwierdzenie oznacza przyjęcie ustaleń trenera, nie zmianę planu treningowego. Ten kontekst nie jest częścią kopii ani synchronizacji Tracking.</p>
    {error && <p role="alert">{error} <button className="button button--ghost" disabled={busy} onClick={() => void run(() => service.listContext())}>Wczytaj ponownie</button></p>}
    {!context && !error && <p>Wczytywanie kontekstu…</p>}
    <form onSubmit={submit} className="human-coach-form">
      <fieldset disabled={busy || !context}>
        <legend>Nowy szkic</legend>
        <label>Rodzaj<select value={kind} onChange={(event) => setKind(event.target.value as HumanCoachItem['kind'])}>{Object.entries(kindLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
        {(kind === 'TASK' || kind === 'TARGET') && <label>Tytuł<input required value={title} onChange={(event) => setTitle(event.target.value)} /></label>}
        {kind !== 'TARGET' && <label>{kind === 'TASK' ? 'Opis (opcjonalnie)' : 'Treść źródłowa / treść decyzji'}<textarea required={kind !== 'TASK'} rows={4} value={text} onChange={(event) => setText(event.target.value)} /></label>}
        {kind === 'NOTE' ? <label>Sposób wprowadzenia<select value={noteSource} onChange={(event) => setNoteSource(event.target.value as typeof noteSource)}><option value="MANUAL">Wpisano ręcznie</option><option value="TRAINER_TEXT">Wklejono tekst trenera</option></select></label>
          : <label>Na podstawie notatki<select value={sourceNoteId} onChange={(event) => setSourceNoteId(event.target.value)}><option value="">Ręczne ustalenie bez notatki źródłowej</option>{notes.map((note) => <option key={note.id} value={note.id}>{note.text.slice(0, 60)} ({note.id})</option>)}</select></label>}
        <label>Źródło / odnośnik (opcjonalnie)<input value={sourceReference} onChange={(event) => setSourceReference(event.target.value)} /></label>
        {kind === 'TARGET' && <label>Typ celu<select value={targetType} onChange={(event) => setTargetType(event.target.value as typeof targetType)}><option value="REP_RANGE">Zakres powtórzeń</option><option value="BODYWEIGHT">Masa ciała (kg)</option><option value="WAIST">Talia (cm)</option></select></label>}
        {(kind === 'TASK' || kind === 'DECISION' || (kind === 'TARGET' && targetType === 'REP_RANGE')) && <label>Ćwiczenie — dokładne ID<select required={kind === 'TARGET'} value={exerciseId} onChange={(event) => setExerciseId(event.target.value)}><option value="">Bez powiązania</option>{data.exerciseLibrary.map((definition, index) => <option key={`${definition.id}-${index}`} value={definition.id}>{definition.name} ({definition.id})</option>)}</select></label>}
        {kind === 'TARGET' && (targetType === 'REP_RANGE'
          ? <><label>Od<input required type="number" min="1" step="1" value={minimum} onChange={(event) => setMinimum(event.target.value)} /></label><label>Do<input required type="number" min="1" step="1" value={maximum} onChange={(event) => setMaximum(event.target.value)} /></label></>
          : <label>Wartość<input required type="number" min="0.01" step="any" value={value} onChange={(event) => setValue(event.target.value)} /></label>)}
        <button className="button button--primary" type="submit">Zapisz szkic</button>
      </fieldset>
    </form>
    <section className="human-coach-items" aria-label="Zapisany kontekst trenera">
      {context?.items.length === 0 && <p>Brak zapisanych ustaleń.</p>}
      {context?.items.map((item) => <article className="human-coach-item" key={item.id} id={`coach-${item.id}`}>
        <h2>{kindLabels[item.kind]} · {item.acceptance.state === 'DRAFT' ? 'Szkic — niezatwierdzony' : 'Zatwierdzone ustalenie'}</h2>
        {'title' in item && <h3>{item.title}</h3>}
        {'text' in item && <p className="human-coach-source">{item.text}</p>}
        {item.kind === 'TASK' && <><p>{item.description}</p><p>Status: {taskLabels[item.status]}</p></>}
        {item.kind === 'TARGET' && <p>{item.specification.type === 'REP_RANGE' ? `${item.specification.min}–${item.specification.max} powt.` : `${item.specification.value} ${item.specification.unit}`} · {item.status === 'ACTIVE' ? 'Aktywny' : 'Wycofany'}{item.retiredAt && ` · ${item.retiredAt}`}</p>}
        {linkedExerciseIds(item).map((id) => <p key={id}>{exerciseLabel(id)}</p>)}
        <small>ID: {item.id} · Utworzono: {item.createdAt} · {item.provenance.sourceType === 'MANUAL' ? 'Wpis ręczny' : 'Tekst trenera'}{item.provenance.sourceReference && ` · Źródło: ${item.provenance.sourceReference}`}</small>
        {item.provenance.sourceNoteId && <a href={`#coach-${item.provenance.sourceNoteId}`}>Notatka źródłowa: {item.provenance.sourceNoteId}</a>}
        {item.acceptance.state === 'AUTHORITATIVE' && <small>Zatwierdzono: {item.acceptance.acceptedAt}</small>}
        {item.acceptance.state === 'DRAFT' && <button className="button button--secondary" disabled={busy} onClick={() => void run(() => service.acceptCoachItem({ id: item.id, acceptedAt: new Date().toISOString() }))}>Zatwierdź jako ustalenie trenera</button>}
        {item.kind === 'TASK' && item.acceptance.state === 'AUTHORITATIVE' && <label>Zmień status ręcznie<select disabled={busy} value={item.status} onChange={(event) => { const status = event.target.value as typeof item.status; void run(() => service.updateCoachTaskStatus({ id: item.id, status, changedAt: new Date().toISOString() })) }}>{Object.entries(taskLabels).map(([status, label]) => <option key={status} value={status}>{label}</option>)}</select></label>}
        {item.kind === 'TASK' && item.statusHistory.length > 0 && <details><summary>Historia statusu</summary>{item.statusHistory.map((change, index) => <p key={index}>{change.changedAt} · {taskLabels[change.status]}{change.note && ` · ${change.note}`}</p>)}</details>}
        {item.kind === 'TARGET' && item.status === 'ACTIVE' && item.acceptance.state === 'AUTHORITATIVE' && <button className="button button--ghost" disabled={busy} onClick={() => void run(() => service.retireCoachTarget({ id: item.id, retiredAt: new Date().toISOString() }))}>Wycofaj cel</button>}
      </article>)}
    </section>
  </div>
}
