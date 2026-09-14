import { useEffect, useMemo, useRef, useState } from 'react'
import { FakeCompanionModel } from '@greekgod/companion'
import { commandCandidates, createExplicitCommandSession, explicitUserCommandInput, type ActionExecutionResult, type ActionPreparationResult, type CommandModelRequest } from '@greekgod/companion/commands'
import { useApp } from '../context/AppContext'
import { PageHeader } from '../components/PageHeader'
import { observeCommandReaction } from '../services/companionReactions'

export function ExplicitCommand() {
  const { data, trackingCommands, lastTrackingCommandResult } = useApp()
  const gateway = useRef(trackingCommands); gateway.current = trackingCommands
  const session = useMemo(() => createExplicitCommandSession({
    get supportsConfirmedTrackingMutations() { return gateway.current.supportsConfirmedTrackingMutations },
    changeTemplateRepRange: async (plan) => {
      const result = await gateway.current.changeTemplateRepRange(plan)
      return result.status === 'APPLIED' ? { status: 'APPLIED', receipt: result.receipt } : result
    },
  }), [])
  useEffect(() => () => session.cancel(), [session])
  const [text, setText] = useState('')
  const [reference, setReference] = useState('')
  const [min, setMin] = useState('')
  const [max, setMax] = useState('')
  const [result, setResult] = useState<ActionPreparationResult>()
  const [execution, setExecution] = useState<ActionExecutionResult>()
  const [busy, setBusy] = useState(false)
  const busyRef = useRef(false)
  const candidates = commandCandidates(data)
  const reconciliation = execution?.status === 'INDETERMINATE' && lastTrackingCommandResult?.status === 'INDETERMINATE'
    ? lastTrackingCommandResult.reconciliation : undefined
  const invalidate = () => { session.cancel(); setResult(undefined); setExecution(undefined) }
  const prepare = async () => {
    if (busyRef.current) return
    busyRef.current = true; setBusy(true); invalidate()
    try {
      // Explicitly configured fake response. Never parse text or choose the first matching name.
      const model = new FakeCompanionModel<CommandModelRequest>({ action: 'CHANGE_TEMPLATE_REP_RANGE',
        candidateRefs: reference ? [reference] : candidates.map((item) => item.reference), minReps: Number(min), maxReps: Number(max) })
      setResult(await session.prepare(explicitUserCommandInput(text), data, model))
    } catch (error) { setResult({ status: 'INVALID', message: error instanceof Error ? error.message : 'Nieprawidłowe polecenie' }) }
    finally { busyRef.current = false; setBusy(false) }
  }
  const apply = async () => {
    if (busyRef.current || result?.status !== 'PREVIEWED') return
    busyRef.current = true; setBusy(true)
    try {
      const executed = await session.execute(session.confirm(result))
      setExecution(executed)
      observeCommandReaction(executed.status)
    }
    catch { setExecution({ status: 'FAILED', message: 'Potwierdzenie wygasło; przygotuj nowy podgląd' }) }
    finally { setResult(undefined); busyRef.current = false; setBusy(false) }
  }
  return <div className="page human-coach-page">
    <PageHeader eyebrow="JAWNE POLECENIE" title="Polecenie dla aplikacji" description="Oddzielna ścieżka od notatek trenera. Tylko zmiana zakresu powtórzeń jednego wiersza szablonu." />
    <p>Tryb fake: tekst nie jest analizowany. Poniższa konfiguracja podaje odpowiedź testowego modelu; nic nie zapisuje się bez osobnego potwierdzenia.</p>
    <form className="human-coach-form" onSubmit={(event) => event.preventDefault()}>
      <fieldset disabled={busy}>
        <legend>Konfiguracja odpowiedzi fake — nie parser języka</legend>
        <label>Twoje jawne polecenie<textarea value={text} onChange={(event) => { invalidate(); setText(event.target.value) }} /></label>
        <label>Kandydat<select value={reference} onChange={(event) => { invalidate(); setReference(event.target.value) }}>
          <option value="">Wszyscy kandydaci — wymagaj rozstrzygnięcia</option>
          {candidates.map((item, index) => <option key={item.reference} value={item.reference}>{item.templateName} · {item.exerciseName} · pozycja {index + 1}</option>)}
        </select></label>
        <label>Nowe minimum powtórzeń<input type="number" min="1" step="1" value={min} onChange={(event) => { invalidate(); setMin(event.target.value) }} /></label>
        <label>Nowe maksimum powtórzeń<input type="number" min="1" step="1" value={max} onChange={(event) => { invalidate(); setMax(event.target.value) }} /></label>
        <button type="button" className="button button--primary" onKeyDown={(event) => { if (event.key === 'Enter') event.preventDefault() }} onClick={() => void prepare()}>Przygotuj zmianę</button>
      </fieldset>
    </form>
    {!trackingCommands.supportsConfirmedTrackingMutations && <p>Ta zmiana może zostać zastosowana tylko w aplikacji Desktop z bezpiecznym zapisem. Tutaj dostępny jest podgląd.</p>}
    {result?.status === 'INVALID' && <p role="alert">{result.message}</p>}
    {result?.status === 'AMBIGUOUS' && <section><h2>Niejednoznaczny cel — wybierz dokładny wiersz</h2>{result.candidates.map((item, index) => <button type="button" key={item.reference} className="button button--ghost" onClick={() => setResult(session.resolve(item.reference, data))}>{item.templateName} · {item.exerciseName} · {item.prescription} · kandydat {index + 1}</button>)}</section>}
    {result?.status === 'PREVIEWED' && <section className="human-coach-item">
      <h2>CHANGE_TEMPLATE_REP_RANGE</h2><h3>{result.templateName} · {result.exerciseName}</h3>
      <p>{result.plan.beforePrescription} → {result.plan.afterPrescription}</p>
      <details><summary>Tożsamość techniczna celu</summary><small>Szablon: {result.plan.templateId} · Wiersz: {result.plan.templateExerciseId} · Ćwiczenie: {result.plan.exerciseId}</small></details>
      <p>Historia i tożsamość ćwiczenia pozostają bez zmian. Zmiana stanu szablonu unieważni ten podgląd.</p>
      <button type="button" className="button button--primary" disabled={busy || !trackingCommands.supportsConfirmedTrackingMutations} onKeyDown={(event) => { if (event.key === 'Enter') event.preventDefault() }} onClick={() => void apply()}>Zatwierdź zmianę</button>
    </section>}
    {result && <button type="button" className="button button--ghost" disabled={busy} onClick={invalidate}>Anuluj bez zapisu</button>}
    {busy && <p role="status">Oczekiwanie na wynik…</p>}
    {execution && <section role="status"><h2>{execution.status}</h2>{execution.status === 'APPLIED'
      ? <><p>{execution.receipt.beforePrescription} → {execution.receipt.afterPrescription}</p><p>Zapisano: {execution.receipt.appliedAt} · Rewizja: {execution.receipt.resultingRevision}</p><details><summary>Dowód techniczny</summary><small>Wiersz: {execution.receipt.templateExerciseId} · Ćwiczenie: {execution.receipt.exerciseId}</small></details></>
      : execution.status === 'INDETERMINATE'
        ? <><p>Nie otrzymano pewnego wyniku zapisu. Aplikacja weryfikuje zapisany stan; komenda nie zostanie ponowiona automatycznie.</p>
          {reconciliation ? <p>{reconciliation.desiredStatePresent ? 'Stan zweryfikowany: żądany zakres jest zapisany.' : 'Stan zweryfikowany: żądana zmiana nie jest obecna; potrzebny jest nowy podgląd i potwierdzenie.'} Aktualny zapis: {reconciliation.observedPrescription ?? 'brak docelowego wiersza'}.</p>
            : <p>Dalsze zmiany są wstrzymane do odzyskania bezpiecznego odczytu.</p>}</>
        : <p>{execution.message}. Przygotuj nowy podgląd przed ponowną próbą.</p>}</section>}
  </div>
}
