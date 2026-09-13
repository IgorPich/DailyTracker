import type { ProposedCoachDraft, ProposedDraftFields } from '@greekgod/companion'
import type { CreateDraftFromNoteCommand } from '@greekgod/human-coach'

/** Called only after explicit review; source binding comes from the original validated proposal. */
export const reviewedProposalCommand = (
  original: ProposedCoachDraft,
  edited: ProposedDraftFields,
  id: string,
  createdAt: string,
): CreateDraftFromNoteCommand => {
  const base = { id, createdAt, sourceNoteId: original.sourceNoteId }
  if (edited.kind === 'TASK') return { ...base, kind: 'TASK', title: edited.title, description: edited.description, exerciseIds: [...edited.exerciseIds] }
  if (edited.kind === 'DECISION') return { ...base, kind: 'DECISION', text: edited.text, exerciseIds: [...edited.exerciseIds] }
  const spec = edited.specification
  if (spec.type === 'REP_RANGE') {
    if (!spec.exerciseId) throw new Error('Wybierz ćwiczenie dla celu przed przyjęciem propozycji')
    return { ...base, kind: 'TARGET', title: edited.title, specification: { ...spec, exerciseId: spec.exerciseId } }
  }
  return { ...base, kind: 'TARGET', title: edited.title, specification: { ...spec } }
}
