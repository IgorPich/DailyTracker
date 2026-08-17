export type Phase = 'Maintenance' | 'Lean Gain' | 'Mini Cut' | 'Redukcja'

export interface DailyEntry {
  id: string
  date: string
  weight?: number
  calories?: number
  protein?: number
  fat?: number
  steps?: number
  waist?: number
  sleep?: number
  recovery?: number
  note?: string
}

export interface WorkoutSet {
  id: string
  weight?: number
  reps?: number
  rir?: number
}

export interface WorkoutExercise {
  id: string
  name: string
  prescription?: string
  sets: WorkoutSet[]
  skipped?: boolean
  isCustom?: boolean
}

export interface Workout {
  id: string
  date: string
  templateId: string
  templateCode: string
  templateName: string
  exercises: WorkoutExercise[]
  duration?: number
  note?: string
}

export interface TemplateExercise {
  id: string
  name: string
  prescription: string
  defaultSets: number
}

export interface TrainingTemplate {
  id: string
  code: 'A' | 'B' | 'C' | 'D'
  name: string
  exercises: TemplateExercise[]
}

export interface Settings {
  phase: Phase
  calorieTarget: number
  proteinTarget: number
  weightTarget?: number
}

export interface AppData {
  version: number
  dailyEntries: DailyEntry[]
  workouts: Workout[]
  templates: TrainingTemplate[]
  settings: Settings
}
