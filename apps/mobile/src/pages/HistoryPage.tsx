import { useState } from 'react'
import { ChevronLeft, MapPin, Trash2 } from 'lucide-react'
import { formatSet } from '@greekgod/core'
import { useMobileData } from '../context/MobileDataContext'
import { deleteMobileWorkout } from '../domain/mobileModel'

export const HistoryPage = ({ goBack }: { goBack: () => void }) => {
  const { data, mutate, saving } = useMobileData()
  const [expanded, setExpanded] = useState<string>()
  if (!data) return null
  const workouts = [...data.workouts].sort((left, right) => right.date.localeCompare(left.date))
  const removeWorkout = async (workoutId: string) => {
    if (!window.confirm('Usunąć ten trening? Zostanie usunięty także z innych zsynchronizowanych urządzeń.')) return
    await mutate((current) => deleteMobileWorkout(current, workoutId))
    setExpanded(undefined)
  }
  return (
    <main className="mobile-page">
      <button className="back-button" type="button" onClick={goBack}><ChevronLeft size={18} /> Start</button>
      <p className="eyebrow">Lokalne archiwum</p><h1>Historia</h1>
      <div className="history-list">{workouts.map((workout) => <article className="surface history-card" key={workout.id}>
        <button type="button" onClick={() => setExpanded(expanded === workout.id ? undefined : workout.id)}><span><small>{workout.date}</small><strong>{workout.templateCode} · {workout.templateName}</strong><em><MapPin size={13} /> {workout.gymLocation ?? 'Nie podano'}</em></span><b>{workout.exercises.filter((item) => item.sets.length).length} ćw.</b></button>
        {expanded === workout.id && <div className="history-details">{workout.exercises.map((exercise) => <div key={exercise.id}><strong>{exercise.name}</strong><span>{exercise.sets.map(formatSet).join(' · ') || 'Brak serii'}</span></div>)}<button className="secondary-button history-delete" type="button" disabled={saving} onClick={() => void removeWorkout(workout.id)}><Trash2 size={17} /> {saving ? 'Usuwam…' : 'Usuń trening'}</button></div>}
      </article>)}</div>
      {!workouts.length && <section className="surface empty-surface"><p>Historia pojawi się po pierwszym treningu lub synchronizacji z PC.</p></section>}
    </main>
  )
}
