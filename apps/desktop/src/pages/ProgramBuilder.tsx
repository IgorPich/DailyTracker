import { useRef, useState } from 'react'
import { duplicateProgramTemplate, openProgramDraft, programVersion, reorderProgramItems, validateProgram, type TrainingTemplate } from '@greekgod/core'
import { useApp } from '../context/AppContext'
import { PageHeader } from '../components/PageHeader'
import { ExercisePicker } from '../components/ExercisePicker'
import { confirmAction } from '../services/fileService'
import type { ProgramSaveResult } from '../services/programPersistence'

export function ProgramBuilder({ onClose }: { onClose: () => void }) {
  const { data, programPersistence, lastProgramSaveResult } = useApp()
  const [draft, setDraft] = useState(() => openProgramDraft(data.templates))
  const [selectedId, setSelectedId] = useState(data.templates[0]?.id)
  const [busy, setBusy] = useState(false)
  const saving = useRef(false)
  const [result, setResult] = useState<ProgramSaveResult>()
  const [validation, setValidation] = useState('')
  const [replacement, setReplacement] = useState<string>()
  const drag = useRef<{ kind: 'template' | 'slot'; id: string; templateId?: string }>()
  const blockedDraft = result?.status === 'STALE_PROGRAM' || result?.status === 'INDETERMINATE' || result?.status === 'PERSISTENCE_FAILED'
  const locked = busy || blockedDraft
  const selected = draft.templates.find((template) => template.id === selectedId)
  const dirty = programVersion(draft.templates) !== draft.baseline
  const edit = (change: (templates: TrainingTemplate[]) => TrainingTemplate[]) => {
    if (locked) return
    setDraft((current) => ({ ...current, templates: change(current.templates) })); setValidation(''); setResult(undefined)
  }
  const editSelected = (change: (template: TrainingTemplate) => TrainingTemplate) => edit((templates) => templates.map((template) => template.id === selectedId ? change(template) : template))
  const moveTemplate = (from: number, to: number) => edit((templates) => reorderProgramItems(templates, from, to))
  const moveSlot = (from: number, to: number) => editSelected((template) => ({ ...template, exercises: reorderProgramItems(template.exercises, from, to) }))
  const removeTemplate = async (id: string) => {
    if (locked || draft.templates.length === 1) return
    if (!await confirmAction('Usunięcie treningu z programu nie usuwa zapisanej historii treningów. Usunąć kartę z draftu?', 'Usuń z programu')) return
    edit((templates) => templates.length > 1 ? templates.filter((template) => template.id !== id) : templates)
    setReplacement(undefined)
  }
  const refresh = async () => {
    if (busy || (result?.status === 'INDETERMINATE' && !programPersistence.supportsProgramSave)) return
    if (dirty && !await confirmAction('Odrzucić draft i wczytać obecny zapisany program?', 'Wczytaj zapisany program')) return
    setDraft(openProgramDraft(data.templates)); setSelectedId(data.templates[0]?.id); setResult(undefined); setValidation(''); setReplacement(undefined)
  }
  const save = async () => {
    if (saving.current || locked || !programPersistence.supportsProgramSave) return
    try { validateProgram(draft.templates, data.exerciseLibrary) }
    catch (error) { setValidation(String(error)); return }
    saving.current = true; setBusy(true)
    try {
      const saved = await programPersistence.saveProgram(draft)
      setResult(saved)
      if (saved.status === 'APPLIED') setDraft(openProgramDraft(saved.data.templates))
    } finally { saving.current = false; setBusy(false) }
  }
  const observed = result?.status === 'INDETERMINATE' && lastProgramSaveResult?.status === 'INDETERMINATE' ? lastProgramSaveResult.desiredProgramPresent : undefined
  return <div className="page human-coach-page program-builder">
    <PageHeader eyebrow="PROGRAM SANDBOX" title="Edytuj program" description="Edytujesz lokalny draft. Zapisz program stosuje całość; Anuluj zmiany nie zapisuje niczego. Historia treningów pozostaje bez zmian." />
    <div className="page-actions">
      <button type="button" className="button button--primary" disabled={locked || !dirty || !programPersistence.supportsProgramSave} onClick={() => void save()}>Zapisz program</button>
      <button type="button" className="button button--ghost" disabled={busy} onClick={onClose}>Anuluj zmiany / zamknij</button>
      <button type="button" className="button button--ghost" disabled={busy || (result?.status === 'INDETERMINATE' && !programPersistence.supportsProgramSave)} onClick={() => void refresh()}>Wczytaj zapisany program</button>
    </div>
    {!programPersistence.supportsProgramSave && <p>Sandbox dostępny. Trwały zapis wymaga Desktop z dostępną bezpieczną authority.</p>}
    {validation && <p role="alert">{validation}</p>}
    {result && <p role="status">{result.status === 'APPLIED' ? `Program zapisany. Rewizja: ${result.resultingRevision}.` : `${result.status}: ${result.message}`}
      {result.status === 'INDETERMINATE' && (observed === undefined ? ' Trwa weryfikacja zapisanego stanu; bez automatycznego ponowienia.' : observed ? ' Zweryfikowany program odpowiada draftowi.' : ' Zweryfikowany program różni się od draftu. Wczytaj go i przejrzyj ponownie.')}</p>}
    <p>Co najmniej jeden zapisany trening. Przeciągaj karty lub użyj przycisków ↑ / ↓. Kolejność jest częścią programu.</p>
    <fieldset disabled={locked}>
      <legend>Treningi ({draft.templates.length})</legend>
      <button type="button" className="button button--secondary" onClick={() => {
        const template: TrainingTemplate = { id: crypto.randomUUID(), code: 'Trening', name: 'Nowy trening', exercises: [] }
        edit((templates) => [...templates, template]); setSelectedId(template.id); setReplacement(undefined)
      }}>Dodaj trening</button>
      <div className="program-builder__cards">
        {draft.templates.map((template, index) => <article className="card" key={template.id} draggable={!locked}
          onDragStart={(event) => { if (locked) return; drag.current = { kind: 'template', id: template.id }; event.dataTransfer.setData('text/plain', template.id) }}
          onDragEnd={() => { drag.current = undefined }} onDragOver={(event) => { if (drag.current?.kind === 'template') event.preventDefault() }}
          onDrop={(event) => { event.preventDefault(); if (drag.current?.kind === 'template') moveTemplate(draft.templates.findIndex((item) => item.id === drag.current!.id), index); drag.current = undefined }}>
          <h2>{template.name}</h2><p>{template.code} · {template.exercises.length} ćwiczeń</p>
          <button type="button" className="button button--ghost" onClick={() => { setSelectedId(template.id); setReplacement(undefined) }}>Otwórz / edytuj</button>
          <button type="button" className="button button--ghost" disabled={index === 0} onClick={() => moveTemplate(index, index - 1)} aria-label={`Przesuń ${template.name} wcześniej`}>↑</button>
          <button type="button" className="button button--ghost" disabled={index === draft.templates.length - 1} onClick={() => moveTemplate(index, index + 1)} aria-label={`Przesuń ${template.name} później`}>↓</button>
          <button type="button" className="button button--ghost" onClick={() => edit((templates) => [...templates, duplicateProgramTemplate(template, () => crypto.randomUUID())])}>Duplikuj</button>
          <button type="button" className="button button--ghost" disabled={draft.templates.length === 1} onClick={() => void removeTemplate(template.id)}>Usuń</button>
        </article>)}
      </div>
      {selected && <section className="card">
        <h2>Ćwiczenia — {selected.name}</h2>
        <label>Nazwa treningu<input value={selected.name} onChange={(event) => editSelected((template) => ({ ...template, name: event.target.value }))} /></label>
        <label>Skrót / etykieta<input value={selected.code} onChange={(event) => editSelected((template) => ({ ...template, code: event.target.value }))} /></label>
        <p>Zmiana ćwiczenia zastępuje tylko referencję w tym slocie. Nie zmienia definicji ani historii.</p>
        {selected.exercises.map((slot, index) => <article className="human-coach-item" key={slot.id} draggable={!locked}
          onDragStart={(event) => { event.stopPropagation(); drag.current = { kind: 'slot', id: slot.id, templateId: selected.id }; event.dataTransfer.setData('text/plain', slot.id) }}
          onDragEnd={() => { drag.current = undefined }} onDragOver={(event) => { if (drag.current?.kind === 'slot' && drag.current.templateId === selected.id) event.preventDefault() }}
          onDrop={(event) => { event.preventDefault(); event.stopPropagation(); if (drag.current?.kind === 'slot' && drag.current.templateId === selected.id) moveSlot(selected.exercises.findIndex((item) => item.id === drag.current!.id), index); drag.current = undefined }}>
          <h3>{slot.name}</h3>
          <label>Preskrypcja<input value={slot.prescription} onChange={(event) => editSelected((template) => ({ ...template, exercises: template.exercises.map((item) => item.id === slot.id ? { ...item, prescription: event.target.value } : item) }))} /></label>
          <label>Liczba serii<input type="number" min="1" step="1" value={slot.defaultSets} onChange={(event) => editSelected((template) => ({ ...template, exercises: template.exercises.map((item) => item.id === slot.id ? { ...item, defaultSets: Number(event.target.value) } : item) }))} /></label>
          <button type="button" className="button button--ghost" disabled={index === 0} onClick={() => moveSlot(index, index - 1)}>↑</button>
          <button type="button" className="button button--ghost" disabled={index === selected.exercises.length - 1} onClick={() => moveSlot(index, index + 1)}>↓</button>
          <button type="button" className="button button--ghost" onClick={() => editSelected((template) => ({ ...template, exercises: [...template.exercises, { ...structuredClone(slot), id: crypto.randomUUID() }] }))}>Duplikuj referencję</button>
          <button type="button" className="button button--ghost" onClick={() => editSelected((template) => ({ ...template, exercises: template.exercises.filter((item) => item.id !== slot.id) }))}>Usuń z draftu</button>
          <button type="button" className="button button--ghost" onClick={() => setReplacement(replacement === slot.id ? undefined : slot.id)}>Zmień ćwiczenie</button>
          {replacement === slot.id && <ExercisePicker library={data.exerciseLibrary} value={slot.exerciseId} onSelect={(definition) => {
            editSelected((template) => ({ ...template, exercises: template.exercises.map((item) => item.id === slot.id ? { ...item, exerciseId: definition.id, name: definition.name, equipmentSensitive: definition.equipmentSensitive } : item) })); setReplacement(undefined)
          }} />}
        </article>)}
        <h3>Dodaj istniejące ćwiczenie</h3><ExercisePicker library={data.exerciseLibrary} onSelect={(definition) => editSelected((template) => ({ ...template, exercises: [...template.exercises,
          { id: crypto.randomUUID(), exerciseId: definition.id, name: definition.name, equipmentSensitive: definition.equipmentSensitive, prescription: '', defaultSets: 1 }] }))} />
        <p>Po dodaniu wpisz preskrypcję i liczbę serii. Definicje ćwiczeń nie są tworzone w sandboxie.</p>
      </section>}
    </fieldset>
  </div>
}
