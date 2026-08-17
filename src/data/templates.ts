import type { TrainingTemplate } from '../types'

const exercise = (id: string, name: string, prescription: string, defaultSets: number) => ({
  id,
  name,
  prescription,
  defaultSets,
})

export const DEFAULT_TEMPLATES: TrainingTemplate[] = [
  {
    id: 'push',
    code: 'A',
    name: 'PUSH',
    exercises: [
      exercise('bench-press', 'Bench Press', '1 × 4–6 + 2 × 6–8', 3),
      exercise('incline-dumbbell-press', 'Incline Dumbbell Press', '3 × 6–10', 3),
      exercise('cable-fly', 'Cable Fly Low-to-High', '2 × 8–12', 2),
      exercise('lateral-raise-machine', 'Lateral Raise Machine', '4 × 10–15', 4),
      exercise('overhead-triceps-extension', 'Overhead Triceps Extension', '3 × 8–12', 3),
      exercise('rope-pushdown', 'Rope Pushdown', '2 × 10–15', 2),
      exercise('cable-crunch', 'Cable Crunch', '3 × 8–12', 3),
    ],
  },
  {
    id: 'pull',
    code: 'B',
    name: 'PULL',
    exercises: [
      exercise('pull-up', 'Pull-Up / Weighted Pull-Up', '3 × 6–10', 3),
      exercise('chest-supported-row', 'Chest-Supported Row', '3 × 6–10', 3),
      exercise('single-arm-lat-pulldown', 'Single-Arm Lat Pulldown', '3 × 8–12 / strona', 3),
      exercise('straight-arm-pulldown', 'Straight-Arm Pulldown', '2 × 10–15', 2),
      exercise('rear-delt-machine', 'Rear Delt Machine', '3 × 12–20', 3),
      exercise('ez-curl', 'EZ / Barbell Curl', '3 × 6–10', 3),
      exercise('bayesian-curl', 'Bayesian Cable Curl', '2 × 10–15', 2),
      exercise('reverse-curl', 'Reverse Curl', '2 × 8–12', 2),
      exercise('wrist-curl', 'Wrist Curl', '2 × 12–20', 2),
    ],
  },
  {
    id: 'legs',
    code: 'C',
    name: 'LEGS + ABS',
    exercises: [
      exercise('hack-squat', 'Hack Squat / Pendulum / Squat Machine', '3 × 6–10', 3),
      exercise('romanian-deadlift', 'Romanian Deadlift', '3 × 6–10', 3),
      exercise('leg-curl', 'Leg Curl', '3 × 8–12', 3),
      exercise('leg-extension', 'Leg Extension', '2 × 10–15', 2),
      exercise('adductor', 'Adductor', '2 × 10–15', 2),
      exercise('calf-raise', 'Calf Raise', '4 × 8–15', 4),
      exercise('hanging-leg-raise', 'Hanging Leg Raise', '3 × 8–15', 3),
    ],
  },
  {
    id: 'greek-upper',
    code: 'D',
    name: 'GREEK UPPER',
    exercises: [
      exercise('incline-smith', 'Incline Smith / Machine Press', '3 × 6–10', 3),
      exercise('lat-pulldown', 'Neutral / Medium Lat Pulldown', '3 × 8–12', 3),
      exercise('machine-row', 'Chest-Supported Machine Row', '3 × 8–12', 3),
      exercise('lateral-raise-cable', 'Lateral Raise Cable / Machine', '4 × 12–20', 4),
      exercise('reverse-fly', 'Reverse Fly', '2 × 12–20', 2),
      exercise('preacher-curl', 'Preacher Curl', '2 × 8–12', 2),
      exercise('overhead-triceps-extension-d', 'Overhead Triceps Extension', '2 × 8–12', 2),
      exercise('cable-crunch-d', 'Cable Crunch / Ab Machine', '3 × 10–15', 3),
    ],
  },
]
