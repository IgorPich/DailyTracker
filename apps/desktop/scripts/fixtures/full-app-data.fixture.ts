import type { AppData } from '../../src/types'

export const fullAppDataFixture = (): AppData => ({
  version: 4,
  dailyEntries: [
    {
      id: 'daily-z',
      date: '2026-08-25',
      weight: 82.35,
      calories: 0,
      protein: 187.5,
      fat: 61.25,
      carbs: 312.75,
      steps: 12345,
      waist: 79.8,
      sleep: 0,
      recovery: 7.25,
      note: '',
    },
    {
      id: 'daily-a',
      date: '2026-08-21',
      weight: 81.9,
    },
  ],
  workouts: [
    {
      id: 'workout-z',
      date: '2026-08-24',
      templateId: 'template-d',
      templateCode: 'D',
      templateName: 'UPPER SNAPSHOT',
      duration: 67.5,
      gymLocation: 'Klub Północ',
      note: '',
      exercises: [
        {
          id: 'workout-row-z',
          exerciseId: 'canonical-row',
          name: 'Historyczny snapshot wiosła',
          prescription: '3 × 6–10',
          skipped: false,
          isCustom: false,
          equipmentSensitive: true,
          note: 'Ustawienie siedziska 4.5',
          sets: [
            { id: 'row-set-z', weight: 82.5, reps: 7, rir: 1.5 },
            { id: 'row-set-a', reps: 9 },
          ],
        },
        {
          id: 'workout-custom-a',
          exerciseId: 'custom-lateral',
          name: 'Własne unoszenie bokiem',
          sets: [
            { id: 'custom-set-b', weight: 12.25, reps: 13, rir: 0 },
            { id: 'custom-set-a', weight: 10.75 },
          ],
          isCustom: true,
          equipmentSensitive: false,
        },
      ],
    },
    {
      id: 'workout-a',
      date: '2026-08-20',
      templateId: 'template-a',
      templateCode: 'A',
      templateName: 'PUSH SNAPSHOT',
      exercises: [
        {
          id: 'workout-press-a',
          exerciseId: 'canonical-press',
          name: 'Historyczny snapshot wyciskania',
          sets: [
            { id: 'press-set-b', weight: 91.25, reps: 5 },
            { id: 'press-set-a' },
          ],
        },
      ],
    },
  ],
  templates: [
    {
      id: 'template-d',
      code: 'D',
      name: 'UPPER',
      exercises: [
        {
          id: 'template-row-z',
          exerciseId: 'canonical-row',
          name: 'Wiosło syntetyczne',
          prescription: '3 × 6–10',
          defaultSets: 3,
          equipmentSensitive: true,
        },
        {
          id: 'template-custom-a',
          exerciseId: 'custom-lateral',
          name: 'Własne unoszenie bokiem',
          prescription: '4 × 12–15',
          defaultSets: 4,
          equipmentSensitive: false,
        },
      ],
    },
    {
      id: 'template-a',
      code: 'A',
      name: 'PUSH',
      exercises: [
        {
          id: 'template-press-a',
          exerciseId: 'canonical-press',
          name: 'Wyciskanie syntetyczne',
          prescription: '2 × 5–8',
          defaultSets: 2,
        },
      ],
    },
  ],
  exerciseLibrary: [
    {
      id: 'canonical-row',
      name: 'Wiosło syntetyczne',
      equipmentSensitive: true,
      aliases: ['Historyczny snapshot wiosła'],
    },
    {
      id: 'custom-lateral',
      name: 'Własne unoszenie bokiem',
      equipmentSensitive: false,
    },
    {
      id: 'canonical-press',
      name: 'Wyciskanie syntetyczne',
      equipmentSensitive: false,
      aliases: ['Historyczny snapshot wyciskania'],
    },
  ],
  settings: {
    phase: 'Lean Gain',
    calorieTarget: 3125,
    proteinTarget: 187.5,
    weightTarget: 84.25,
    gymLocations: ['Klub Północ', 'Klub Zachód'],
    lastGymLocation: 'Klub Północ',
    trendThresholds: {
      lossBelow: -0.175,
      stableUpper: 0.075,
      slowGainUpper: 0.225,
    },
  },
  coachNotes: {
    '2026-08-z': 'Syntetyczna notatka z polskimi znakami: ążźć',
    '2026-08-a': '',
  },
})
