import { useMemo, useState } from 'react'
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { canonicalExerciseId, exerciseOccurrencesByWorkout, formatSet, getBestSet, isEquipmentSensitive } from '@greekgod/core'
import { useMobileData } from '../context/MobileDataContext'

export const ProgressPage = () => {
  const { data } = useMobileData()
  const [exerciseId, setExerciseId] = useState('')
  const [gym, setGym] = useState('')
  const exerciseOptions = useMemo(() => {
    const options = new Map<string, { id: string; name: string; equipmentSensitive?: boolean }>()
    for (const item of data?.exerciseLibrary ?? []) options.set(item.id, item)
    for (const workout of data?.workouts ?? []) for (const exercise of workout.exercises) {
      const id = canonicalExerciseId(exercise)
      if (!options.has(id)) options.set(id, { id, name: exercise.name, equipmentSensitive: isEquipmentSensitive(exercise) })
    }
    return [...options.values()].sort((left, right) => left.name.localeCompare(right.name, 'pl'))
  }, [data])
  const selected = exerciseOptions.find((item) => item.id === exerciseId) ?? exerciseOptions[0]
  const sensitive = isEquipmentSensitive(selected)
  const allOccurrences = useMemo(() => data && selected
    ? exerciseOccurrencesByWorkout(data.workouts, (exercise) => canonicalExerciseId(exercise) === selected.id, isEquipmentSensitive)
      .sort((left, right) => left.workout.date.localeCompare(right.workout.date))
    : [], [data, selected])
  const occurrences = allOccurrences.filter((item) => !sensitive || (Boolean(gym) && item.workout.gymLocation === gym))
  const gyms = [...new Set([
    ...(data?.settings.gymLocations ?? []),
    ...allOccurrences.flatMap((item) => item.workout.gymLocation ? [item.workout.gymLocation] : []),
  ])]
  if (!data) return null
  const activeId = selected?.id ?? ''
  const latest = occurrences.at(-1)
  const chart = occurrences.map((item) => ({ date: item.workout.date.slice(5), weight: getBestSet(item.exercise)?.weight }))
  return (
    <main className="mobile-page"><p className="eyebrow">Analityka offline</p><h1>Progres</h1>
      <div className="progress-filters"><label className="mobile-field full"><span>Ćwiczenie</span><select value={activeId} onChange={(event) => { setExerciseId(event.target.value); setGym('') }}>{exerciseOptions.map((item) => <option value={item.id} key={item.id}>{item.name}</option>)}</select></label>{sensitive && <label className="mobile-field full"><span>Siłownia</span><select value={gym} onChange={(event) => setGym(event.target.value)}><option value="">Wybierz siłownię</option>{gyms.map((item) => <option key={item}>{item}</option>)}</select></label>}</div>
      <section className="surface progress-latest"><p className="card-kicker">Ostatni wynik</p><strong>{latest ? formatSet(getBestSet(latest.exercise)) : '—'}</strong><small>{latest ? `${latest.workout.date} · ${latest.workout.gymLocation ?? 'bez siłowni'}` : 'Brak sesji'}</small></section>
      <section className="surface chart-card"><ResponsiveContainer width="100%" height={220}><LineChart data={chart} margin={{ top: 15, right: 14, left: -20, bottom: 0 }}><CartesianGrid stroke="#242830" vertical={false} /><XAxis dataKey="date" stroke="#737b86" fontSize={11} /><YAxis stroke="#737b86" fontSize={11} domain={['dataMin - 5', 'dataMax + 5']} /><Tooltip contentStyle={{ background: '#171a1f', border: '1px solid #2a2e35', borderRadius: 10 }} /><Line type="monotone" dataKey="weight" stroke="#2997ff" strokeWidth={3} dot={{ fill: '#2997ff', r: 3 }} /></LineChart></ResponsiveContainer></section>
      <section className="session-list"><p className="card-kicker">Historia sesji</p>{[...occurrences].reverse().map((item) => <div className="surface" key={item.workout.id}><span><strong>{item.workout.date}</strong><small>{item.workout.gymLocation ?? 'Nie podano'}</small></span><b>{formatSet(getBestSet(item.exercise))}</b></div>)}</section>
    </main>
  )
}
