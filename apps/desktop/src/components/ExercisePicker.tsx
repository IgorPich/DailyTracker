import { useId, useMemo, useState } from 'react'
import type { ExerciseDefinition } from '../types'
import { exerciseSearchOptions, searchExercises, selectExerciseResult, type ExerciseSearchOption } from '../utils/exerciseSearch'

export function ExercisePicker({ library, options, value, onSelect, autoFocus = false }: {
  library: ExerciseDefinition[]
  options?: ExerciseSearchOption[]
  value?: string
  onSelect: (definition: ExerciseDefinition) => void
  autoFocus?: boolean
}) {
  const id = useId()
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const [highlight, setHighlight] = useState(-1)
  const candidates = useMemo(() => options ?? exerciseSearchOptions(library), [library, options])
  const results = searchExercises(candidates, query)
  const selected = candidates.find((item) => item.definition.id === value)
  const choose = (option: ExerciseSearchOption) => {
    // Recheck exact persisted identity, never infer selection from query text.
    if (!selectExerciseResult(library, option, onSelect)) return
    setQuery(''); setOpen(false); setHighlight(-1)
  }
  return <div className="exercise-picker" onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false) }}>
    {selected && <small>Wybrane: {selected.label}</small>}
    <input autoFocus={autoFocus} role="combobox" aria-label="Wyszukaj ćwiczenie" aria-autocomplete="list" aria-expanded={open} aria-controls={`${id}-results`} aria-activedescendant={open && highlight >= 0 && highlight < results.length ? `${id}-${highlight}` : undefined}
      placeholder="Wyszukaj ćwiczenie..." value={query}
      onFocus={() => setOpen(true)}
      onChange={(event) => { setQuery(event.target.value); setOpen(true); setHighlight(-1) }}
      onKeyDown={(event) => {
        if (event.key === 'ArrowDown') { event.preventDefault(); setOpen(true); setHighlight((index) => Math.min(index + 1, results.length - 1)) }
        if (event.key === 'ArrowUp') { event.preventDefault(); setOpen(true); setHighlight((index) => Math.max(index - 1, 0)) }
        if (event.key === 'Escape') { event.preventDefault(); setOpen(false); setHighlight(-1) }
        if (event.key === 'Enter') { event.preventDefault(); if (open && highlight >= 0 && results[highlight]) choose(results[highlight]) }
      }} />
    {open && <div id={`${id}-results`} role="listbox" aria-label="Istniejące ćwiczenia" className="exercise-picker__results">
      {results.map((option, index) => <button type="button" role="option" id={`${id}-${index}`} key={option.definition.id} aria-selected={option.definition.id === value} className={highlight === index ? 'active' : ''} onMouseDown={(event) => event.preventDefault()} onClick={() => choose(option)}>
        <span>{option.label}</span>{option.detail && <small>{option.detail}</small>}
      </button>)}
      {!results.length && <p>Brak wyników. Wpisany tekst nie tworzy nowego ćwiczenia.</p>}
    </div>}
  </div>
}

export function ExerciseReplacementPicker({ library, title, onSelect, onClose }: {
  library: ExerciseDefinition[]; title: string; onSelect: (definition: ExerciseDefinition) => void; onClose: () => void
}) {
  return <section className="card exercise-replacement-picker" aria-label={title}>
    <strong>{title}</strong><p>Wybierz istniejące ćwiczenie. Wpisywanie nazwy nie zmienia tożsamości.</p>
    <ExercisePicker autoFocus library={library} onSelect={onSelect} />
    <button type="button" className="button button--ghost" onClick={onClose}>Anuluj wybór</button>
  </section>
}
