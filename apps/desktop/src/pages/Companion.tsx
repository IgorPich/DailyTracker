import { useEffect, useRef, useState, type FormEvent } from 'react'
import { MessageCircle, Settings as SettingsIcon, SlidersHorizontal } from 'lucide-react'
import { createReadOnlyCompanion, userDialogueInput } from '@greekgod/companion/readonly'
import type { AvatarPresentationState } from '@greekgod/companion/reactions'
import { AvatarPresenter } from '../components/AvatarPresenter'
import { PageHeader } from '../components/PageHeader'
import { useApp } from '../context/AppContext'
import { buildCompanionProductContext, resolveCompanionProductEvidence } from '../services/companionProductContext'
import { observeReadOnlyReaction, reactionSnapshot } from '../services/companionReactions'
import { managedCompanionModel, managedCompanionRuntime, type LocalModelStatus } from '../services/localCompanionModel'

type ProductAiState = 'NOT_INSTALLED' | 'LOADING' | 'READY' | 'UNAVAILABLE'
interface DialogueTurn { question: string; answer: string; evidence: readonly { label: string; text: string }[] }
const initialAvatar = (): AvatarPresentationState => ({ semanticReaction: 'NEUTRAL', token: null, startedAt: null, reducedMotion: false })

export const companionProductAiState = (status?: LocalModelStatus): ProductAiState => {
  if (!status) return 'LOADING'
  if (['RUNTIME_MISSING', 'RUNTIME_INVALID', 'MODEL_MISSING', 'MODEL_INVALID', 'CHECKSUM_MISMATCH'].includes(status.state)) return 'NOT_INSTALLED'
  if (['STARTING', 'INFERENCE_ACTIVE'].includes(status.state)) return 'LOADING'
  if (['READY_UNLOADED', 'READY_WARM', 'IDLE_UNLOADED', 'READY'].includes(status.state)) return 'READY'
  return 'UNAVAILABLE'
}
const statusLabel: Record<ProductAiState, string> = {
  NOT_INSTALLED: 'Lokalne AI nie jest zainstalowane',
  LOADING: 'Ładowanie lokalnego AI…',
  READY: 'Gotowy',
  UNAVAILABLE: 'Tymczasowo niedostępny',
}

export function Companion({ onOpenSettings, onOpenCommand }: { onOpenSettings: () => void; onOpenCommand: () => void }) {
  const { data } = useApp()
  const dataRef = useRef(data); dataRef.current = data
  const [text, setText] = useState('')
  const [turns, setTurns] = useState<DialogueTurn[]>([])
  const [status, setStatus] = useState<LocalModelStatus>()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [reducedMotion, setReducedMotion] = useState(false)
  const [avatar, setAvatar] = useState<AvatarPresentationState>(initialAvatar)
  const busyRef = useRef(false)
  const productState = companionProductAiState(status)
  const refreshStatus = async () => setStatus(await managedCompanionRuntime.status())

  useEffect(() => { void refreshStatus() }, [])
  useEffect(() => {
    const media = window.matchMedia('(prefers-reduced-motion: reduce)')
    const update = () => setReducedMotion(media.matches)
    update(); media.addEventListener('change', update)
    return () => media.removeEventListener('change', update)
  }, [])
  useEffect(() => {
    const update = () => setAvatar(reactionSnapshot(reducedMotion).presentation)
    update(); const timer = window.setInterval(update, 250)
    return () => window.clearInterval(timer)
  }, [reducedMotion])

  const send = async (event: FormEvent) => {
    event.preventDefault()
    const question = text
    if (busyRef.current || !question.trim() || productState !== 'READY') return
    busyRef.current = true; setBusy(true); setError(''); setText('')
    setStatus({ state: status?.state === 'READY_WARM' ? 'INFERENCE_ACTIVE' : 'STARTING', detail: 'Local inference in progress' })
    try {
      const context = await buildCompanionProductContext(question, dataRef.current)
      const runtime = createReadOnlyCompanion({ readEvidence: async () => context.evidence }, managedCompanionModel)
      const result = await runtime.dialogue(userDialogueInput(question))
      observeReadOnlyReaction('USER_DIALOGUE', result.status)
      if (result.status !== 'MESSAGE') throw new Error('Invalid read-only response')
      const selected = resolveCompanionProductEvidence(context, result.response.evidenceIds)
      setTurns((current) => [...current, { question, answer: result.response.message, evidence: selected }])
    } catch {
      observeReadOnlyReaction('USER_DIALOGUE', 'INVALID')
      setError('Companion nie może teraz bezpiecznie odpowiedzieć. Dane treningowe nie zostały zmienione.')
    } finally {
      busyRef.current = false; setBusy(false); await refreshStatus()
    }
  }

  return <div className="page companion-page">
    <PageHeader eyebrow="LOKALNY COMPANION" title="Companion" description="Rozmowa tylko do odczytu, oparta na lokalnym modelu i jawnie wybranych danych." />
    <section className="card companion-hero">
      <AvatarPresenter state={avatar} />
      <div><span className={`companion-status companion-status--${productState.toLowerCase()}`}>{statusLabel[productState]}</span>
        <p>Rozmowa nie zapisuje zmian w planie, treningach, kontekście trenera ani pamięci.</p></div>
    </section>

    {productState === 'NOT_INSTALLED' && <section className="card companion-notice"><h2>Lokalne AI jest opcjonalne</h2>
      <p>GreekGod i cały Tracking działają bez niego. Instalację i sprawdzenie plików znajdziesz w ustawieniach.</p>
      <button type="button" className="button button--secondary" onClick={onOpenSettings}><SettingsIcon size={16} /> Companion AI w ustawieniach</button></section>}
    {productState === 'UNAVAILABLE' && <section className="card companion-notice"><p>Companion jest chwilowo niedostępny. Możesz odświeżyć stan albo sprawdzić szczegóły w ustawieniach.</p>
      <button type="button" className="button button--ghost" onClick={() => void refreshStatus()}>Sprawdź ponownie</button>
      <button type="button" className="button button--ghost" onClick={onOpenSettings}>Otwórz ustawienia</button></section>}

    <section className="companion-dialogue" aria-label="Bieżąca rozmowa">
      {!turns.length && <div className="companion-empty"><MessageCircle size={24} /><h2>Zapytaj o swoje zapisane dane lub kontekst trenera</h2><p>Historia tej rozmowy istnieje tylko do czasu opuszczenia ekranu.</p></div>}
      {turns.map((turn, index) => <article className="companion-turn" key={index}>
        <p className="companion-turn__user"><strong>Ty</strong>{turn.question}</p>
        <div className="companion-turn__answer"><strong>Companion</strong><p>{turn.answer}</p>
          {!!turn.evidence.length && <details><summary>Na podstawie zapisanych danych ({turn.evidence.length})</summary>
            <ul>{turn.evidence.map((item, evidenceIndex) => <li key={evidenceIndex}><strong>{item.label}</strong><span>{item.text}</span></li>)}</ul>
          </details>}</div>
      </article>)}
    </section>

    {error && <p className="companion-error" role="alert">{error}</p>}
    <form className="companion-composer" onSubmit={send}>
      <label htmlFor="companion-message">Wiadomość</label>
      <textarea id="companion-message" rows={3} value={text} disabled={busy || productState !== 'READY'}
        placeholder={productState === 'READY' ? 'Np. Ile czasu trenowałem w ostatnich 30 dniach?' : statusLabel[productState]}
        onChange={(event) => setText(event.target.value)} />
      <div><button type="submit" className="button button--primary" disabled={busy || productState !== 'READY' || !text.trim()}>{busy ? 'Companion odpowiada…' : 'Wyślij'}</button>
        {!!turns.length && <button type="button" className="button button--ghost" disabled={busy} onClick={() => setTurns([])}>Wyczyść tę sesję</button>}</div>
    </form>

    <section className="card companion-command-boundary"><div><SlidersHorizontal size={20} /><div><h2>Polecenie dla aplikacji</h2>
      <p>Zmiany planu mają osobny podgląd i wymagają jawnego potwierdzenia. Tekst wpisany powyżej nigdy nie uruchamia tej ścieżki.</p></div></div>
      <button type="button" className="button button--secondary" onClick={onOpenCommand}>Przejdź do polecenia</button></section>
  </div>
}
