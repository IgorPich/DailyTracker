import { ChevronLeft } from 'lucide-react'
import { useMobileData } from '../context/MobileDataContext'
import { nextTemplate } from '../domain/mobileModel'

export const WorkoutPreviewPage = ({ startWorkout, goBack }: {
  startWorkout: () => void
  goBack: () => void
}) => {
  const { data, saving } = useMobileData()
  const template = data ? nextTemplate(data) : undefined
  if (!data || !template) return <main className="mobile-page"><button className="back-button" type="button" onClick={goBack}><ChevronLeft size={18} /> Start</button><p>Brak treningu do wyświetlenia.</p></main>

  return <main className="mobile-page">
    <button className="back-button" type="button" onClick={goBack}><ChevronLeft size={18} /> Start</button>
    <p className="eyebrow">Podgląd treningu</p>
    <h1>{template.code} · {template.name}</h1>
    <section className="surface workout-preview-list">
      {template.exercises.map((exercise, index) => <div key={exercise.id}>
        <span>{String(index + 1).padStart(2, '0')}</span>
        <p><strong>{exercise.name}</strong><small>{exercise.prescription}</small></p>
      </div>)}
    </section>
    <p className="safe-copy">Samo wyświetlenie tego ekranu nie tworzy sesji.</p>
    <button className="primary-button workout-preview-start" type="button" disabled={saving} onClick={startWorkout}>{saving ? 'Rozpoczynam…' : 'Rozpocznij trening'}</button>
  </main>
}
