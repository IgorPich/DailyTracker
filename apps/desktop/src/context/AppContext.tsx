import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import {
  addGymLocation as addGymLocationToData,
  addWorkout as addWorkoutToHistory,
  deleteDailyEntry as deleteDailyEntryFromList,
  deleteGymLocation as deleteGymLocationFromData,
  deleteWorkout as deleteWorkoutFromHistory,
  findWorkoutById,
  renameGymLocation as renameGymLocationInData,
  replaceTrainingTemplate,
  updateWorkout as updateWorkoutInHistory,
  upsertDailyEntry as upsertDailyEntryInList,
} from '@greekgod/core'
import type { AppData, DailyEntry, ExerciseDefinition, Settings, TrainingTemplate, Workout, WorkoutExercise } from '../types'
import { appDataStore } from '../services/appDataStore'
import { canonicalExerciseId, normalizeExerciseName, renameExerciseDefinition, withRegisteredExercise } from '../utils/exerciseIdentity'
import { createId } from '../utils/id'
import { createInitialData } from '../utils/storage'

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

const attachWorkoutExerciseIdentities = (
  library: ExerciseDefinition[],
  exercises: WorkoutExercise[],
  previousExercises?: WorkoutExercise[],
) => {
  let nextLibrary = library
  const nextExercises = exercises.map((exercise) => {
    const explicitId = exercise.exerciseId?.trim()
    if (explicitId) {
      const existingDefinition = nextLibrary.find((definition) => definition.id === explicitId)
      if (!existingDefinition) {
        nextLibrary = [...nextLibrary, {
          id: explicitId,
          name: exercise.name.trim().replace(/\s+/g, ' '),
          equipmentSensitive: Boolean(exercise.equipmentSensitive),
        }]
      } else {
        const previous = previousExercises?.find((item) => item.id === exercise.id)
        const previousSensitivity = previous?.equipmentSensitive ?? existingDefinition.equipmentSensitive
        const currentSensitivity = exercise.equipmentSensitive ?? existingDefinition.equipmentSensitive
        const sensitivityChanged = previousSensitivity !== currentSensitivity
        if (sensitivityChanged) {
          nextLibrary = renameExerciseDefinition(nextLibrary, explicitId, existingDefinition.name, currentSensitivity)
        }
      }
      return { ...exercise, exerciseId: explicitId }
    }
    const registered = withRegisteredExercise(
      nextLibrary,
      exercise.name,
      Boolean(exercise.equipmentSensitive),
      `exercise-${createId()}`,
    )
    nextLibrary = registered.library
    return {
      ...exercise,
      exerciseId: registered.definition.id,
      equipmentSensitive: registered.definition.equipmentSensitive,
    }
  })
  return { library: nextLibrary, exercises: nextExercises }
}

const updateTemplateAndLibrary = (current: AppData, template: TrainingTemplate) => {
  const previousTemplate = current.templates.find((item) => item.id === template.id)
  let library = current.exerciseLibrary
  const changedDefinitions = new Set<string>()

  const exercises = template.exercises.map((exercise) => {
    const previous = previousTemplate?.exercises.find((item) => item.id === exercise.id)
    let exerciseId = exercise.exerciseId?.trim() || previous?.exerciseId?.trim()
    if (!exerciseId) {
      const registered = withRegisteredExercise(
        library,
        exercise.name,
        Boolean(exercise.equipmentSensitive),
        `exercise-${createId()}`,
      )
      library = registered.library
      exerciseId = registered.definition.id
    } else if (!library.some((definition) => definition.id === exerciseId)) {
      library = [...library, {
        id: exerciseId,
        name: exercise.name.trim().replace(/\s+/g, ' '),
        equipmentSensitive: Boolean(exercise.equipmentSensitive),
      }]
    }

    const sameIdentity = previous && canonicalExerciseId(previous) === exerciseId
    const definition = library.find((item) => item.id === exerciseId)!
    const nextName = exercise.name.trim().replace(/\s+/g, ' ')
    const sensitivityChanged = sameIdentity && Boolean(exercise.equipmentSensitive) !== definition.equipmentSensitive
    const nameChanged = sameIdentity && normalizeExerciseName(nextName) !== normalizeExerciseName(previous.name)
    if (nameChanged || sensitivityChanged) {
      library = renameExerciseDefinition(library, exerciseId, nameChanged ? nextName : definition.name, Boolean(exercise.equipmentSensitive))
      changedDefinitions.add(exerciseId)
    }
    const resolved = library.find((item) => item.id === exerciseId)!
    return {
      ...exercise,
      exerciseId,
      name: sameIdentity ? nextName : resolved.name,
      equipmentSensitive: resolved.equipmentSensitive,
    }
  })

  const replacedTemplates = replaceTrainingTemplate(
    current.templates,
    { ...structuredClone(template), exercises },
  )
  const templates = replacedTemplates.map((item) => ({
    ...item,
    exercises: item.exercises.map((exercise) => {
      const exerciseId = canonicalExerciseId(exercise)
      if (!changedDefinitions.has(exerciseId)) return exercise
      const definition = library.find((candidate) => candidate.id === exerciseId)!
      return { ...exercise, name: definition.name, equipmentSensitive: definition.equipmentSensitive }
    }),
  }))
  return { library, templates }
}

export function AppProvider({ children }: { children: ReactNode }) {
  const [data, setData] = useState<AppData>(createInitialData)
  const [hydrated, setHydrated] = useState(false)
  const [loadError, setLoadError] = useState(false)

  useEffect(() => {
    let active = true
    void appDataStore.load()
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
    void appDataStore.save(data).catch((error) => console.error('Nie udało się zapisać danych GreekGod.', error))
  }, [data, hydrated])

  useEffect(() => {
    if (!hydrated || !appDataStore.loadIfChanged) return
    let active = true
    let polling = false
    const poll = async () => {
      if (polling) return
      polling = true
      try {
        const changed = await appDataStore.loadIfChanged?.()
        if (active && changed) setData(changed)
      } catch (error) {
        console.error('Nie udało się odświeżyć danych GreekGod po synchronizacji.', error)
      } finally {
        polling = false
      }
    }
    const interval = window.setInterval(() => { void poll() }, 1_500)
    return () => {
      active = false
      window.clearInterval(interval)
    }
  }, [hydrated])

  const value = useMemo<AppContextValue>(() => ({
    data,
    upsertDailyEntry: (entry) => {
      setData((current) => ({
        ...current,
        dailyEntries: upsertDailyEntryInList(current.dailyEntries, entry),
      }))
    },
    deleteDailyEntry: (id) => {
      setData((current) => ({ ...current, dailyEntries: deleteDailyEntryFromList(current.dailyEntries, id) }))
    },
    addWorkout: (workout) => {
      setData((current) => {
        const attached = attachWorkoutExerciseIdentities(current.exerciseLibrary, workout.exercises)
        return {
          ...current,
          exerciseLibrary: attached.library,
          workouts: addWorkoutToHistory(current.workouts, { ...workout, exercises: attached.exercises }),
        }
      })
    },
    updateWorkout: (workout) => {
      setData((current) => {
        const previous = findWorkoutById(current.workouts, workout.id)
        const attached = attachWorkoutExerciseIdentities(current.exerciseLibrary, workout.exercises, previous?.exercises)
        return {
          ...current,
          exerciseLibrary: attached.library,
          workouts: updateWorkoutInHistory(current.workouts, { ...workout, exercises: attached.exercises }),
        }
      })
    },
    deleteWorkout: (id) => {
      setData((current) => ({ ...current, workouts: deleteWorkoutFromHistory(current.workouts, id) }))
    },
    updateTemplate: (template) => {
      setData((current) => {
        const updated = updateTemplateAndLibrary(current, template)
        return { ...current, templates: updated.templates, exerciseLibrary: updated.library }
      })
    },
    updateSettings: (settings) => {
      setData((current) => ({ ...current, settings: { ...current.settings, ...settings } }))
    },
    addGymLocation: (name) => {
      setData((current) => addGymLocationToData(current, name))
    },
    renameGymLocation: (currentName, nextName) => {
      setData((current) => renameGymLocationInData(current, currentName, nextName))
    },
    deleteGymLocation: (name) => {
      setData((current) => deleteGymLocationFromData(current, name))
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
