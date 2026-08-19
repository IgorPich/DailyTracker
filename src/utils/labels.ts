import type { Phase } from '../types'

export const PHASE_LABELS: Record<Phase, string> = {
  Maintenance: 'Zero kaloryczne',
  'Lean Gain': 'Kontrolowana masa',
  'Mini Cut': 'Mini redukcja',
  Redukcja: 'Redukcja',
}

export const phaseLabel = (phase: Phase) => PHASE_LABELS[phase]
