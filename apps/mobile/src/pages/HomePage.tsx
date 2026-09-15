import { BookOpen, ChevronRight, History } from 'lucide-react'
import { latestWorkout, nextTemplate } from '../domain/mobileModel'
import { useMobileData } from '../context/MobileDataContext'
import { journalConfiguration, measurementValue, metricIsTracked } from '@greekgod/core'
import { isoToday } from '../domain/mobileModel'

const phaseLabel = {
  Maintenance: 'Zero kaloryczne',
  'Lean Gain': 'Kontrolowana masa',
  'Mini Cut': 'Mini redukcja',
  Redukcja: 'Redukcja',
} as const

export const HomePage = ({ previewWorkout, openJournal, openHistory }: {
  previewWorkout: () => void
  openJournal: () => void
  openHistory: () => void
}) => {
  const { data, saving } = useMobileData()
  if (!data) return null
  const suggested = nextTemplate(data)
  const recent = latestWorkout(data.workouts)
  const latestEntry = [...data.dailyEntries].sort((a, b) => b.date.localeCompare(a.date))[0]
  const weightTracked = metricIsTracked(journalConfiguration(data), 'WEIGHT', isoToday())

  return (
    <main className="mobile-page">
      <p className="eyebrow">GreekGod · offline first</p>
      <h1>Gotowy na trening?</h1>
      <section className="hero-card">
        <div><p className="card-kicker">Następny trening</p><h2>{suggested ? `${suggested.code} · ${suggested.name}` : 'Brak planu'}</h2><p className="muted">{suggested ? `${suggested.exercises.length} ćwiczeń` : 'Dodaj plan na komputerze i zsynchronizuj'}</p></div>
        <button className="primary-button" type="button" disabled={!suggested || saving} onClick={previewWorkout}>Zobacz trening</button>
      </section>
      <div className="metric-grid">
        <section className="surface metric-card"><p className="card-kicker">Aktualna faza</p><strong>{phaseLabel[data.settings.phase]}</strong></section>
        <section className="surface metric-card"><p className="card-kicker">Cel kalorii</p><strong>{data.settings.calorieTarget} <small>kcal</small></strong></section>
        <section className="surface metric-card"><p className="card-kicker">Ostatnia waga</p><strong>{weightTracked ? `${measurementValue(latestEntry,'WEIGHT') ?? '—'} kg` : 'Nieśledzona'}</strong></section>
        <section className="surface metric-card"><p className="card-kicker">Ostatni trening</p><strong>{recent ? `${recent.templateCode} · ${recent.date.slice(5).replace('-', '.')}` : '—'}</strong></section>
      </div>
      <button className="surface journal-shortcut" type="button" onClick={openJournal}><span><BookOpen size={20} /></span><span><strong>Uzupełnij Dziennik</strong><small>Twoje śledzone metryki</small></span><ChevronRight size={20} /></button>
      <button className="surface journal-shortcut" type="button" onClick={openHistory}><span><History size={20} /></span><span><strong>Historia treningów</strong><small>{data.workouts.length} zapisanych sesji</small></span><ChevronRight size={20} /></button>
    </main>
  )
}
