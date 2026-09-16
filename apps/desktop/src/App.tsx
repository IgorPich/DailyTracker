import { lazy, Suspense, useState } from 'react'
import {
  BarChart3,
  BookOpen,
  Dumbbell,
  FileText,
  MessageCircle,
  TrendingUp,
  Menu,
  Settings as SettingsIcon,
  X,
} from 'lucide-react'
import greekGodIcon from './assets/formlog-logo.png'

const Dashboard = lazy(async () => ({ default: (await import('./pages/Dashboard')).Dashboard }))
const Journal = lazy(async () => ({ default: (await import('./pages/Journal')).Journal }))
const Training = lazy(async () => ({ default: (await import('./pages/Training')).Training }))
const Progress = lazy(async () => ({ default: (await import('./pages/Progress')).Progress }))
const CoachReport = lazy(async () => ({ default: (await import('./pages/CoachReport')).CoachReport }))
const HumanCoach = lazy(async () => ({ default: (await import('./pages/HumanCoach')).HumanCoach }))
const Companion = lazy(async () => ({ default: (await import('./pages/Companion')).Companion }))
const ExplicitCommand = lazy(async () => ({ default: (await import('./pages/ExplicitCommand')).ExplicitCommand }))
const CompanionMemory = import.meta.env.DEV
  ? lazy(async () => ({ default: (await import('./pages/CompanionMemory')).CompanionMemory }))
  : undefined
const CompanionReactions = import.meta.env.DEV
  ? lazy(async () => ({ default: (await import('./pages/CompanionReactions')).CompanionReactions }))
  : undefined
const Settings = lazy(async () => ({ default: (await import('./pages/Settings')).Settings }))
const ProgramBuilder = lazy(async () => ({ default: (await import('./pages/ProgramBuilder')).ProgramBuilder }))
const JournalSettings = lazy(async () => ({ default: (await import('./pages/JournalSettings')).JournalSettings }))

export type View = 'dashboard' | 'training' | 'progress' | 'journal' | 'report' | 'settings' | 'human-coach' | 'companion' | 'explicit-command' | 'companion-memory' | 'companion-reactions' | 'program-builder' | 'journal-settings'

const navItems = [
  { id: 'dashboard' as const, label: 'Panel', mobileLabel: 'Panel', icon: BarChart3 },
  { id: 'training' as const, label: 'Trening', mobileLabel: 'Trening', icon: Dumbbell },
  { id: 'progress' as const, label: 'Progres', mobileLabel: 'Progres', icon: TrendingUp },
  { id: 'journal' as const, label: 'Dziennik', mobileLabel: 'Dziennik', icon: BookOpen },
  { id: 'report' as const, label: 'Raport dla trenera', mobileLabel: 'Raport', icon: FileText },
]

export default function App() {
  const [view, setView] = useState<View>('dashboard')
  const [menuOpen, setMenuOpen] = useState(false)
  const [requestedWorkoutId, setRequestedWorkoutId] = useState<string | undefined>()

  const navigate = (next: View) => {
    setRequestedWorkoutId(undefined)
    setView(next)
    setMenuOpen(false)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  return (
    <div className="app-shell">
      <aside className={`sidebar ${menuOpen ? 'sidebar--open' : ''}`}>
        <div className="brand">
          <span className="brand__mark"><img src={greekGodIcon} alt="" /></span>
          <div><strong>GreekGod</strong><small>Dziennik treningowy</small></div>
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
        <button className={view === 'human-coach' ? 'active' : ''} onClick={() => navigate('human-coach')}>
          <BookOpen size={19} /> <span>Kontekst trenera</span>
        </button>
        <button className={view === 'companion' ? 'active' : ''} onClick={() => navigate('companion')}>
          <MessageCircle size={19} /> <span>Companion</span>
        </button>
        <button className={view === 'explicit-command' ? 'active' : ''} onClick={() => navigate('explicit-command')}>
          <FileText size={19} /> <span>Polecenie dla aplikacji</span>
        </button>
        </nav>
        {import.meta.env.DEV && <div className="developer-nav" aria-label="Narzędzia deweloperskie">
          <small>DEVELOPMENT</small>
          <button className={view === 'companion-memory' ? 'active' : ''} onClick={() => navigate('companion-memory')}><BookOpen size={19} /> <span>Pamięć — inspekcja</span></button>
          <button className={view === 'companion-reactions' ? 'active' : ''} onClick={() => navigate('companion-reactions')}><BookOpen size={19} /> <span>Reakcje — diagnostyka</span></button>
        </div>}
        <button className={`settings-link ${view === 'settings' ? 'active' : ''}`} onClick={() => navigate('settings')}>
          <SettingsIcon size={19} /> <span>Ustawienia</span>
        </button>
        <p className="local-note">Dane zapisują się tylko na tym urządzeniu.</p>
      </aside>

      {menuOpen && <button className="sidebar-backdrop" onClick={() => setMenuOpen(false)} aria-label="Zamknij menu" />}

      <div className="app-main">
        <header className="mobile-header">
          <button className="icon-button" onClick={() => setMenuOpen(true)} aria-label="Otwórz menu"><Menu size={21} /></button>
          <div className="brand brand--mobile"><span className="brand__mark"><img src={greekGodIcon} alt="" /></span><strong>GreekGod</strong></div>
          <button className="icon-button" onClick={() => navigate('settings')} aria-label="Ustawienia"><SettingsIcon size={20} /></button>
        </header>
        <main>
          <Suspense fallback={<div className="page-loader"><span /><p>Ładowanie widoku…</p></div>}>
            {view === 'dashboard' && <Dashboard onNavigate={navigate} />}
            {view === 'training' && <Training openWorkoutId={requestedWorkoutId} onWorkoutOpened={() => setRequestedWorkoutId(undefined)} />}
            {view === 'progress' && <Progress onOpenWorkout={(id) => { setRequestedWorkoutId(id); setView('training'); window.scrollTo({ top: 0, behavior: 'smooth' }) }} />}
            {view === 'journal' && <Journal />}
            {view === 'report' && <CoachReport />}
            {view === 'human-coach' && <HumanCoach />}
            {view === 'companion' && <Companion onOpenSettings={() => navigate('settings')} onOpenCommand={() => navigate('explicit-command')} />}
            {view === 'explicit-command' && <ExplicitCommand />}
            {import.meta.env.DEV && CompanionMemory && view === 'companion-memory' && <CompanionMemory />}
            {import.meta.env.DEV && CompanionReactions && view === 'companion-reactions' && <CompanionReactions />}
            {view === 'settings' && <Settings onEditProgram={() => navigate('program-builder')} onEditJournal={()=>navigate('journal-settings')} />}
            {view === 'journal-settings' && <JournalSettings onClose={()=>navigate('settings')} />}
            {view === 'program-builder' && <ProgramBuilder onClose={() => navigate('settings')} />}
          </Suspense>
        </main>
      </div>

      <nav className="bottom-nav" aria-label="Nawigacja mobilna">
        {navItems.map(({ id, mobileLabel, icon: Icon }) => (
          <button key={id} className={view === id ? 'active' : ''} onClick={() => navigate(id)}>
            <Icon size={19} /><span>{mobileLabel}</span>
          </button>
        ))}
      </nav>
    </div>
  )
}
