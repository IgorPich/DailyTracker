import type { CoachNote } from '@greekgod/human-coach'
import type { CompanionModel } from '../ports/companionModel.ts'
import type { ProposedCoachDraft } from './proposal.ts'
import { validateModelOutput } from '../validation/modelOutput.ts'

export interface ProposeCoachDraftsInput {
  note: CoachNote
  exercises: readonly { id: string; name: string }[]
  allowedExerciseIds: readonly string[]
}

export const proposeCoachDraftsFromNote = async (input: ProposeCoachDraftsInput, model: CompanionModel): Promise<ProposedCoachDraft[]> => {
  const { note } = input
  if (note.kind !== 'NOTE' || note.provenance.sourceType !== 'TRAINER_TEXT' || !note.id.trim() || !note.text.trim()) throw new Error('Expected TrainerText CoachNote')
  const sourceNoteId = note.id
  const allowed = new Set(input.allowedExerciseIds)
  if (allowed.size !== input.allowedExerciseIds.length) throw new Error('Duplicate allowlist IDs')
  const exercises = [...allowed].map((id) => {
    const matches = input.exercises.filter((item) => item.id === id)
    if (!id.trim() || id.trim() !== id || matches.length !== 1) throw new Error('Unknown or ambiguous allowed exercise ID')
    return { id, name: matches[0].name }
  })
  // Only note text and explicitly allowed definition labels/IDs cross the port.
  // Keep the binding and allowlist private, independent of provider mutation.
  const raw = await model.propose({ text: note.text, exercises })
  return validateModelOutput(raw, allowed).map((fields) => ({ sourceNoteId, fields }))
}
