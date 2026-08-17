import { lazy, Suspense, useState } from 'react'
import {
  BarChart3,
  BookOpen,
  Dumbbell,
  FileText,
  Menu,
  Settings as SettingsIcon,
  X,
} from 'lucide-react'

const Dashboard = lazy(async () => ({ default: (await import('./pages/Dashboard')).Dashboard }))
const Journal = lazy(async () => ({ default: (await import('./pages/Journal')).Journal }))
const Training = lazy(async () => ({ default: (await import('./pages/Training')).Training }))
const CoachReport = lazy(async () => ({ default: (await import('./pages/CoachReport')).CoachReport }))
const Settings = lazy(async () => ({ default: (await import('./pages/Settings')).Settings }))

export type View = 'dashboard' | 'training' | 'journal' | 'report' | 'settings'

const navItems = [
  { id: 'dashboard' as const, label: 'Dashboard', icon: BarChart3 },
  { id: 'training' as const, label: 'Trening', icon: Dumbbell },
  { id: 'journal' as const, label: 'Dziennik', icon: BookOpen },
  { id: 'report' as const, label: 'Coach Report', icon: FileText },
]

export default function App() {
  const [view, setView] = useState<View>('dashboard')
  const [menuOpen, setMenuOpen] = useState(false)

  const navigate = (next: View) => {
    setView(next)
    setMenuOpen(false)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  return (
    <div className="app-shell">
      <aside className={`sidebar ${menuOpen ? 'sidebar--open' : ''}`}>
        <div className="brand">
          <span className="brand__mark"><Dumbbell size={20} /></span>
          <div><strong>Formlog</strong><small>Daily Tracker</small></div>
        </div>
        <button className="icon-button sidebar__close" onClick={() => setMenuOpen(false)} aria-label="Zamknij menu">
          <X size={20} />
        </button>
        <nav className="main-nav" aria-label="Główna nawigacja">
          {navItems.map(({ id, label, icon: Icon }) => (
            <button key={id} className={view === id ? 'active' : ''} onClick={() => navigate(id)}>
              <Icon size={19} /> <span>{label}</span>
            </button>
          ))}
        </nav>
        <button className={`settings-link ${view === 'settings' ? 'active' : ''}`} onClick={() => navigate('settings')}>
          <SettingsIcon size={19} /> <span>Ustawienia</span>
        </button>
        <p className="local-note">Dane zapisują się tylko na tym urządzeniu.</p>
      </aside>

      {menuOpen && <button className="sidebar-backdrop" onClick={() => setMenuOpen(false)} aria-label="Zamknij menu" />}

      <div className="app-main">
        <header className="mobile-header">
          <button className="icon-button" onClick={() => setMenuOpen(true)} aria-label="Otwórz menu"><Menu size={21} /></button>
          <div className="brand brand--mobile"><span className="brand__mark"><Dumbbell size={17} /></span><strong>Formlog</strong></div>
          <button className="icon-button" onClick={() => navigate('settings')} aria-label="Ustawienia"><SettingsIcon size={20} /></button>
        </header>
        <main>
          <Suspense fallback={<div className="page-loader"><span /><p>Ładowanie widoku…</p></div>}>
            {view === 'dashboard' && <Dashboard onNavigate={navigate} />}
            {view === 'training' && <Training />}
            {view === 'journal' && <Journal />}
            {view === 'report' && <CoachReport />}
            {view === 'settings' && <Settings />}
          </Suspense>
        </main>
      </div>

      <nav className="bottom-nav" aria-label="Nawigacja mobilna">
        {navItems.map(({ id, label, icon: Icon }) => (
          <button key={id} className={view === id ? 'active' : ''} onClick={() => navigate(id)}>
            <Icon size={19} /><span>{label === 'Coach Report' ? 'Raport' : label}</span>
          </button>
        ))}
      </nav>
    </div>
  )
}
