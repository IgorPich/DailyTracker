import type { HumanCoachContext } from '../domain/context.ts'

// Implementations serialize read-modify-write, persist before resolving, and return detached snapshots.
export interface HumanCoachRepository {
  read(): Promise<HumanCoachContext>
  update(change: (current: HumanCoachContext) => HumanCoachContext): Promise<HumanCoachContext>
}

// Read-only exact canonical IDs, not display names or aliases. No Tracking mutation port.
export interface ExerciseReferences {
  readExerciseIds(): readonly string[]
}
