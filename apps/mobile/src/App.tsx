import { useState } from 'react'
import { Activity, BookOpen, Dumbbell, Home, Settings } from 'lucide-react'

type Route = 'home' | 'workout' | 'journal' | 'progress' | 'settings'

const navigation: Array<{ route: Route; label: string; icon: typeof Home }> = [
  { route: 'home', label: 'Start', icon: Home },
  { route: 'workout', label: 'Trening', icon: Dumbbell },
  { route: 'journal', label: 'Dziennik', icon: BookOpen },
  { route: 'progress', label: 'Progres', icon: Activity },
  { route: 'settings', label: 'Więcej', icon: Settings },
]

const PagePlaceholder = ({ route }: { route: Exclude<Route, 'home'> }) => {
  const content = {
    workout: ['Trening', 'Szybki logger serii będzie dostępny offline.'],
    journal: ['Dziennik', 'Pomiary i makroskładniki zapiszą się lokalnie.'],
    progress: ['Progres', 'Historia sesji i wykresy będą liczone z SQLite.'],
    settings: ['Ustawienia i synchronizacja', 'Parowanie z domowym PC bez chmury.'],
  }[route]
  return (
    <main className="mobile-page">
      <p className="eyebrow">GreekGod mobile</p>
      <h1>{content[0]}</h1>
      <section className="surface empty-surface">
        <span className="empty-mark" aria-hidden="true">G</span>
        <p>{content[1]}</p>
      </section>
    </main>
  )
}

const HomePage = ({ startWorkout, openJournal }: { startWorkout: () => void; openJournal: () => void }) => (
  <main className="mobile-page">
    <p className="eyebrow">Czwartek, 27 sierpnia</p>
    <h1>Gotowy na trening?</h1>

    <section className="hero-card">
      <div>
        <p className="card-kicker">Następny trening</p>
        <h2>A · PUSH</h2>
        <p className="muted">7 ćwiczeń · ostatnio 18 sierpnia</p>
      </div>
      <button className="primary-button" type="button" onClick={startWorkout}>Rozpocznij trening</button>
    </section>

    <div className="metric-grid">
      <section className="surface metric-card">
        <p className="card-kicker">Aktualna faza</p>
        <strong>Zero kaloryczne</strong>
      </section>
      <section className="surface metric-card">
        <p className="card-kicker">Cel kalorii</p>
        <strong>2800 <small>kcal</small></strong>
      </section>
    </div>

    <button className="surface journal-shortcut" type="button" onClick={openJournal}>
      <span><BookOpen size={20} /></span>
      <span><strong>Uzupełnij Dziennik</strong><small>Waga, makro i kroki</small></span>
      <span aria-hidden="true">›</span>
    </button>
  </main>
)

export const App = () => {
  const [route, setRoute] = useState<Route>('home')
  return (
    <div className="mobile-shell">
      {route === 'home'
        ? <HomePage startWorkout={() => setRoute('workout')} openJournal={() => setRoute('journal')} />
        : <PagePlaceholder route={route} />}
      <nav className="bottom-navigation" aria-label="Główna nawigacja">
        {navigation.map(({ route: itemRoute, label, icon: Icon }) => (
          <button
            className={route === itemRoute ? 'active' : ''}
            key={itemRoute}
            type="button"
            onClick={() => setRoute(itemRoute)}
          >
            <Icon size={21} strokeWidth={2} />
            <span>{label}</span>
          </button>
        ))}
      </nav>
    </div>
  )
}
