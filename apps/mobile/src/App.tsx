import { useEffect, useRef, useState } from 'react'
import { Activity, BookOpen, Dumbbell, Home, Settings } from 'lucide-react'
import { addWorkout } from '@greekgod/core'
import { useMobileData } from './context/MobileDataContext'
import { activeWorkoutForToday, createWorkoutFromTemplate, nextTemplate } from './domain/mobileModel'
import { HistoryPage } from './pages/HistoryPage'
import { HomePage } from './pages/HomePage'
import { JournalPage } from './pages/JournalPage'
import { ProgressPage } from './pages/ProgressPage'
import { SettingsPage } from './pages/SettingsPage'
import { WorkoutPage } from './pages/WorkoutPage'
import type { MobileRoute } from './routes'

const navigation: Array<{ route: Exclude<MobileRoute, 'history'>; label: string; icon: typeof Home }> = [
  { route: 'home', label: 'Start', icon: Home },
  { route: 'workout', label: 'Trening', icon: Dumbbell },
  { route: 'journal', label: 'Dziennik', icon: BookOpen },
  { route: 'progress', label: 'Progres', icon: Activity },
  { route: 'settings', label: 'Więcej', icon: Settings },
]

export const App = () => {
  const { data, loading, error, mutate, snapshot } = useMobileData()
  const [route, setRoute] = useState<MobileRoute>('home')
  const [workoutId, setWorkoutId] = useState<string>()
  const startingWorkout = useRef(false)
  const restoredRoute = useRef(false)
  useEffect(() => {
    if (!data || restoredRoute.current) return
    restoredRoute.current = true
    const active = activeWorkoutForToday(data.workouts)
    if (active) {
      setWorkoutId(active.id)
      setRoute('workout')
    }
  }, [data])
  useEffect(() => {
    const openActiveWorkout = () => {
      const active = data && activeWorkoutForToday(data.workouts)
      if (active) {
        setWorkoutId(active.id)
        setRoute('workout')
      }
    }
    window.addEventListener('focus', openActiveWorkout)
    return () => window.removeEventListener('focus', openActiveWorkout)
  }, [data])
  if (loading) return <div className="app-state"><span className="loading-mark">G</span><p>Otwieram lokalną bazę…</p></div>
  if (!data || error) return <div className="app-state error-state"><span>!</span><strong>Nie udało się otworzyć danych</strong><p>{error ?? 'Nieznany błąd.'}</p></div>

  const startWorkout = async () => {
    if (startingWorkout.current) return
    startingWorkout.current = true
    try {
      const active = activeWorkoutForToday(data.workouts)
      if (active) { setWorkoutId(active.id); setRoute('workout'); return }
      const template = nextTemplate(data)
      if (!template) return
      const workout = createWorkoutFromTemplate(template, data)
      await mutate((current) => ({ ...current, workouts: addWorkout(current.workouts, workout) }))
      setWorkoutId(workout.id)
      setRoute('workout')
    } finally {
      startingWorkout.current = false
    }
  }

  const openWorkout = () => {
    const selected = workoutId && data.workouts.some((item) => item.id === workoutId)
      ? data.workouts.find((item) => item.id === workoutId)
      : activeWorkoutForToday(data.workouts)
    if (selected) { setWorkoutId(selected.id); setRoute('workout') } else void startWorkout()
  }

  return (
    <div className="mobile-shell">
      {!snapshot || snapshot.probe.journalMode === 'memory' ? <div className="preview-ribbon">Podgląd UI · Android zapisuje do SQLite</div> : null}
      {route === 'home' && <HomePage startWorkout={() => void startWorkout()} openJournal={() => setRoute('journal')} openHistory={() => setRoute('history')} />}
      {route === 'workout' && <WorkoutPage workoutId={workoutId ?? activeWorkoutForToday(data.workouts)?.id} goBack={() => setRoute('home')} />}
      {route === 'journal' && <JournalPage />}
      {route === 'history' && <HistoryPage goBack={() => setRoute('home')} />}
      {route === 'progress' && <ProgressPage />}
      {route === 'settings' && <SettingsPage openHistory={() => setRoute('history')} />}
      {route !== 'history' && <nav className="bottom-navigation" aria-label="Główna nawigacja">{navigation.map(({ route: itemRoute, label, icon: Icon }) => (
        <button className={route === itemRoute ? 'active' : ''} key={itemRoute} type="button" onClick={() => itemRoute === 'workout' ? openWorkout() : setRoute(itemRoute)}><Icon size={21} strokeWidth={2} /><span>{label}</span></button>
      ))}</nav>}
    </div>
  )
}
