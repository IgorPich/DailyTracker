import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import type { AppData, DailyEntry, Settings, Workout } from '../types'
import { createInitialData, loadData, saveData } from '../utils/storage'

interface AppContextValue {
  data: AppData
  upsertDailyEntry: (entry: DailyEntry) => void
  deleteDailyEntry: (id: string) => void
  addWorkout: (workout: Workout) => void
  deleteWorkout: (id: string) => void
  updateSettings: (settings: Partial<Settings>) => void
  replaceData: (data: AppData) => void
  clearData: () => void
}

const AppContext = createContext<AppContextValue | null>(null)

export function AppProvider({ children }: { children: ReactNode }) {
  const [data, setData] = useState<AppData>(loadData)

  useEffect(() => {
    saveData(data)
  }, [data])

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
    deleteWorkout: (id) => {
      setData((current) => ({ ...current, workouts: current.workouts.filter((workout) => workout.id !== id) }))
    },
    updateSettings: (settings) => {
      setData((current) => ({ ...current, settings: { ...current.settings, ...settings } }))
    },
    replaceData: setData,
    clearData: () => setData(createInitialData()),
  }), [data])

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>
}

export const useApp = () => {
  const context = useContext(AppContext)
  if (!context) throw new Error('useApp must be used inside AppProvider')
  return context
}
