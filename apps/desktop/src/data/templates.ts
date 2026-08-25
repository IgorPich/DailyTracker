import type { TrainingTemplate } from '../types'

const exercise = (id: string, name: string, prescription: string, defaultSets: number, equipmentSensitive = false) => ({
  id,
  name,
  prescription,
  defaultSets,
  ...(equipmentSensitive ? { equipmentSensitive: true } : {}),
})

export const DEFAULT_TEMPLATES: TrainingTemplate[] = [
  {
    id: 'push',
    code: 'A',
    name: 'PUSH',
    exercises: [
      exercise('bench-press', 'Wyciskanie sztangi na ławce', '1 × 4–6 + 2 × 6–8', 3),
      exercise('incline-dumbbell-press', 'Wyciskanie hantli na skosie dodatnim', '3 × 6–10', 3),
      exercise('cable-fly', 'Rozpiętki na bramie od dołu', '2 × 8–12', 2, true),
      exercise('lateral-raise-machine', 'Unoszenie bokiem na maszynie', '4 × 10–15', 4, true),
      exercise('overhead-triceps-extension', 'Prostowanie ramion nad głową na wyciągu', '3 × 8–12', 3, true),
      exercise('rope-pushdown', 'Prostowanie ramion na wyciągu z liną', '2 × 10–15', 2, true),
      exercise('cable-crunch', 'Allahy na wyciągu', '3 × 8–12', 3, true),
    ],
  },
  {
    id: 'pull',
    code: 'B',
    name: 'PULL',
    exercises: [
      exercise('pull-up', 'Podciąganie / podciąganie z obciążeniem', '3 × 6–10', 3),
      exercise('chest-supported-row', 'Wiosło na wyciągu', '3 × 6–10', 3, true),
      exercise('single-arm-lat-pulldown', 'Ściąganie drążka jednorącz', '3 × 8–12 / strona', 3, true),
      exercise('straight-arm-pulldown', 'Ściąganie prostych ramion na wyciągu', '2 × 10–15', 2, true),
      exercise('rear-delt-machine', 'Odwrotne rozpiętki na maszynie', '3 × 12–20', 3, true),
      exercise('ez-curl', 'Uginanie ramion ze sztangą łamaną / prostą', '3 × 6–10', 3),
      exercise('bayesian-curl', 'Uginanie bayesowskie na wyciągu', '2 × 10–15', 2, true),
      exercise('reverse-curl', 'Uginanie nachwytem', '2 × 8–12', 2),
      exercise('wrist-curl', 'Uginanie nadgarstków', '2 × 12–20', 2),
    ],
  },
  {
    id: 'legs',
    code: 'C',
    name: 'NOGI + BRZUCH',
    exercises: [
      exercise('hack-squat', 'Hack squat / pendulum / maszyna do przysiadów', '3 × 6–10', 3, true),
      exercise('romanian-deadlift', 'Martwy ciąg rumuński', '3 × 6–10', 3),
      exercise('leg-curl', 'Uginanie nóg na maszynie', '3 × 8–12', 3, true),
      exercise('leg-extension', 'Prostowanie nóg na maszynie', '2 × 10–15', 2, true),
      exercise('adductor', 'Przywodziciele na maszynie', '2 × 10–15', 2, true),
      exercise('calf-raise', 'Wspięcia na palce na maszynie', '4 × 8–15', 4, true),
      exercise('hanging-leg-raise', 'Unoszenie nóg w zwisie', '3 × 8–15', 3),
    ],
  },
  {
    id: 'greek-upper',
    code: 'D',
    name: 'GRECKA GÓRA',
    exercises: [
      exercise('incline-smith', 'Wyciskanie na skosie na Smithie / maszynie', '3 × 6–10', 3, true),
      exercise('lat-pulldown', 'Ściąganie drążka neutralnie / średnio', '3 × 8–12', 3, true),
      exercise('machine-row', 'Wiosło na wyciągu', '3 × 6–10', 3, true),
      exercise('lateral-raise-cable', 'Unoszenie bokiem na wyciągu / maszynie', '4 × 12–20', 4, true),
      exercise('reverse-fly', 'Odwrotne rozpiętki na maszynie', '2 × 12–20', 2, true),
      exercise('preacher-curl', 'Uginanie ramion na modlitewniku', '2 × 8–12', 2),
      exercise('overhead-triceps-extension-d', 'Prostowanie ramion nad głową na wyciągu', '2 × 8–12', 2, true),
      exercise('cable-crunch-d', 'Allahy na wyciągu / maszyna na brzuch', '3 × 10–15', 3, true),
    ],
  },
]
