import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import type { AppData, DailyEntry, Settings, TrainingTemplate, Workout } from '../types'
import { storageService } from '../services/storageService'
import { createInitialData } from '../utils/storage'
import { replaceWorkoutById } from '../utils/workoutData'

interface AppContextValue {
  data: AppData
  upsertDailyEntry: (entry: DailyEntry) => void
  deleteDailyEntry: (id: string) => void
  addWorkout: (workout: Workout) => void
  updateWorkout: (workout: Workout) => void
  deleteWorkout: (id: string) => void
  updateTemplate: (template: TrainingTemplate) => void
  updateSettings: (settings: Partial<Settings>) => void
  addGymLocation: (name: string) => void
  renameGymLocation: (currentName: string, nextName: string) => void
  deleteGymLocation: (name: string) => void
  updateCoachNote: (rangeKey: string, note: string) => void
  replaceData: (data: AppData) => void
  clearData: () => void
}

const AppContext = createContext<AppContextValue | null>(null)

export function AppProvider({ children }: { children: ReactNode }) {
  const [data, setData] = useState<AppData>(createInitialData)
  const [hydrated, setHydrated] = useState(false)
  const [loadError, setLoadError] = useState(false)

  useEffect(() => {
    let active = true
    void storageService.load()
      .then((stored) => {
        if (!active) return
        setData(stored)
        setHydrated(true)
      })
      .catch(() => {
        if (active) setLoadError(true)
      })
    return () => { active = false }
  }, [])

  useEffect(() => {
    if (!hydrated) return
    void storageService.save(data).catch((error) => console.error('Nie udało się zapisać danych GreekGod.', error))
  }, [data, hydrated])

  const value = useMemo<AppContextValue>(() => ({
    data,
    upsertDailyEntry: (entry) => {
      setData((current) => {
        const withoutExistingDate = current.dailyEntries.filter(
          (item) => item.id !== entry.id && item.date !== entry.date,
        )
        return { ...current, dailyEntries: [...withoutExistingDate, entry] }
      })
    },
    deleteDailyEntry: (id) => {
      setData((current) => ({ ...current, dailyEntries: current.dailyEntries.filter((entry) => entry.id !== id) }))
    },
    addWorkout: (workout) => {
      setData((current) => ({ ...current, workouts: [...current.workouts, workout] }))
    },
    updateWorkout: (workout) => {
      setData((current) => ({
        ...current,
        workouts: replaceWorkoutById(current.workouts, workout),
      }))
    },
    deleteWorkout: (id) => {
      setData((current) => ({ ...current, workouts: current.workouts.filter((workout) => workout.id !== id) }))
    },
    updateTemplate: (template) => {
      setData((current) => ({
        ...current,
        templates: current.templates.map((item) => item.id === template.id ? structuredClone(template) : item),
      }))
    },
    updateSettings: (settings) => {
      setData((current) => ({ ...current, settings: { ...current.settings, ...settings } }))
    },
    addGymLocation: (name) => {
      const trimmed = name.trim()
      if (!trimmed) return
      setData((current) => {
        const locations = current.settings.gymLocations ?? []
        if (locations.some((item) => item.localeCompare(trimmed, 'pl', { sensitivity: 'accent' }) === 0)) return current
        return { ...current, settings: { ...current.settings, gymLocations: [...locations, trimmed] } }
      })
    },
    renameGymLocation: (currentName, nextName) => {
      const trimmed = nextName.trim()
      if (!trimmed || currentName === trimmed) return
      setData((current) => {
        const locations = current.settings.gymLocations ?? []
        if (locations.some((item) => item !== currentName && item.localeCompare(trimmed, 'pl', { sensitivity: 'accent' }) === 0)) return current
        return {
          ...current,
          settings: {
            ...current.settings,
            gymLocations: locations.map((item) => item === currentName ? trimmed : item),
            lastGymLocation: current.settings.lastGymLocation === currentName ? trimmed : current.settings.lastGymLocation,
          },
          workouts: current.workouts.map((workout) => workout.gymLocation === currentName ? { ...workout, gymLocation: trimmed } : workout),
        }
      })
    },
    deleteGymLocation: (name) => {
      setData((current) => ({
        ...current,
        settings: {
          ...current.settings,
          gymLocations: (current.settings.gymLocations ?? []).filter((item) => item !== name),
          lastGymLocation: current.settings.lastGymLocation === name ? undefined : current.settings.lastGymLocation,
        },
      }))
    },
    updateCoachNote: (rangeKey, note) => {
      setData((current) => ({ ...current, coachNotes: { ...current.coachNotes, [rangeKey]: note } }))
    },
    replaceData: setData,
    clearData: () => setData(createInitialData()),
  }), [data])

  if (loadError) return <div className="app-boot" role="alert"><span>!</span><p>Nie udało się bezpiecznie wczytać danych. Plik nie został zmieniony.</p></div>
  if (!hydrated) return <div className="app-boot" role="status"><span>G</span><p>Wczytywanie GreekGod…</p></div>

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>
}

export const useApp = () => {
  const context = useContext(AppContext)
  if (!context) throw new Error('useApp must be used inside AppProvider')
  return context
}
