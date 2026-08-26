import type { AppData } from './types'

const sameSavedGymName = (left: string, right: string) => (
  left.localeCompare(right, 'pl', { sensitivity: 'accent' }) === 0
)

export const addGymLocation = (data: AppData, name: string): AppData => {
  const trimmed = name.trim()
  if (!trimmed) return data
  const locations = data.settings.gymLocations ?? []
  if (locations.some((item) => sameSavedGymName(item, trimmed))) return data
  return {
    ...data,
    settings: {
      ...data.settings,
      gymLocations: [...locations, trimmed],
    },
  }
}

export const renameGymLocation = (
  data: AppData,
  currentName: string,
  nextName: string,
): AppData => {
  const trimmed = nextName.trim()
  if (!trimmed || currentName === trimmed) return data
  const locations = data.settings.gymLocations ?? []
  if (locations.some((item) => item !== currentName && sameSavedGymName(item, trimmed))) return data
  return {
    ...data,
    settings: {
      ...data.settings,
      gymLocations: locations.map((item) => item === currentName ? trimmed : item),
      lastGymLocation: data.settings.lastGymLocation === currentName ? trimmed : data.settings.lastGymLocation,
    },
    workouts: data.workouts.map((workout) => (
      workout.gymLocation === currentName ? { ...workout, gymLocation: trimmed } : workout
    )),
  }
}

export const deleteGymLocation = (data: AppData, name: string): AppData => ({
  ...data,
  settings: {
    ...data.settings,
    gymLocations: (data.settings.gymLocations ?? []).filter((item) => item !== name),
    lastGymLocation: data.settings.lastGymLocation === name ? undefined : data.settings.lastGymLocation,
  },
})
