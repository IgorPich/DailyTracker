import { classifyExerciseIdentity, type TrainingTemplate } from '@greekgod/core'
import type { TrackingExerciseHistorySnapshot } from '../../ports/trackingExerciseHistorySnapshot.ts'
import { exerciseExposureHistory } from '../exercise-history/exerciseExposureHistory.ts'
import { exerciseProgressClassification } from '../exercise-progress/exerciseProgressClassification.ts'
import {
  REPORT_SELECTION_VERSION, REPORT_PRIORITY_ORDER, reportPriority,
  type ReportSelectionResult, type SelectedReportExercise, type ReportSelectionReason,
} from '../../domain/report/reportSelection.ts'

export interface ReportSelectionQuery {
  snapshot: TrackingExerciseHistorySnapshot & { templates: readonly TrainingTemplate[] }
  asOf: string
  recentFrom: string
  /** Omitted means all eligible exercises. Applied after all definitions are evaluated. */
  limit?: number
}

const validDate = (date: string) => /^\d{4}-\d{2}-\d{2}$/.test(date)
  && Number.isFinite(Date.parse(date)) && new Date(date).toISOString().slice(0, 10) === date

export const reportSelection = (query: ReportSelectionQuery): ReportSelectionResult => {
  if (!validDate(query.asOf) || !validDate(query.recentFrom) || query.recentFrom > query.asOf) {
    throw new RangeError('Report dates must define an ordered ISO calendar-date interval.')
  }
  if (query.limit !== undefined && (!Number.isInteger(query.limit) || query.limit < 0)) {
    throw new RangeError('Report limit must be a non-negative integer.')
  }
  const { snapshot, asOf, recentFrom } = query
  const activeTemplates = new Map<string, string[]>()
  for (const template of snapshot.templates) {
    for (const reference of template.exercises) {
      const identity = classifyExerciseIdentity(snapshot.exerciseLibrary, reference)
      if (identity.classification !== 'RESOLVED') continue
      const ids = activeTemplates.get(identity.exerciseId) ?? []
      if (!ids.includes(template.id)) ids.push(template.id)
      activeTemplates.set(identity.exerciseId, ids)
    }
  }
  const candidates: SelectedReportExercise[] = []
  const excludedExercises: ReportSelectionResult['excludedExercises'] = []
  const seen = new Set<string>()
  snapshot.exerciseLibrary.forEach((definition, sourceOrder) => {
    if (seen.has(definition.id)) return
    seen.add(definition.id)
    const history = exerciseExposureHistory({
      snapshot, exerciseId: definition.id, asOf,
      // Search all available history for an earlier comparable exposure, not only five.
      limit: Math.max(1, snapshot.workouts.length),
    })
    if (history.status !== 'READY') {
      excludedExercises.push({ exerciseId: definition.id, reason: 'UNRESOLVED_EXERCISE_IDENTITY' })
      return
    }
    const recent = history.exposures.filter((exposure) => exposure.occurredOn >= recentFrom
      && exposure.workingSets.some((set) => Number.isFinite(set.weight) && Number.isFinite(set.reps)))
    const activeTemplateIds = activeTemplates.get(definition.id) ?? []
    if (!recent.length && !activeTemplateIds.length) {
      excludedExercises.push({ exerciseId: definition.id, reason: 'NO_RECENT_EXPOSURE_OR_ACTIVE_TEMPLATE' })
      return
    }
    const progress = exerciseProgressClassification({ history })
    const recentCurrent = Boolean(progress.currentExposure && progress.currentExposure.occurredOn >= recentFrom)
    const priority = reportPriority(progress, recentCurrent)
    const selectionReasons: ReportSelectionReason[] = []
    if (recent.length) selectionReasons.push('RECENT_EXPOSURE')
    if (activeTemplateIds.length) selectionReasons.push('ACTIVE_TEMPLATE')
    if (recentCurrent && (progress.status === 'PROGRESS' || progress.status === 'REGRESSION')) {
      selectionReasons.push('MEANINGFUL_CHANGE')
    }
    if (priority === 'RECENT_REGRESSION' || priority === 'RECENT_MIXED_OR_TRADE_OFF') {
      selectionReasons.push('NEEDS_ATTENTION')
    }
    if (progress.status === 'INSUFFICIENT_DATA' || progress.status === 'NOT_COMPARABLE') {
      selectionReasons.push('INSUFFICIENT_COMPARABLE_HISTORY')
    }
    candidates.push({
      exerciseId: definition.id, selectionReasons, progress,
      evidence: { activeTemplateIds, recentExposures: recent.map((exposure) => ({
        workoutId: exposure.workoutId,
        workoutExerciseIds: [...exposure.evidence.workoutExerciseIds],
        setIds: [...exposure.evidence.setIds],
      })) },
      ranking: {
        priority, priorityOrder: REPORT_PRIORITY_ORDER[priority],
        ...(recent[0] ? { latestRecentExposureOn: recent[0].occurredOn } : {}),
        activeTemplate: activeTemplateIds.length > 0, sourceOrder,
      },
    })
  })
  candidates.sort((a, b) => a.ranking.priorityOrder - b.ranking.priorityOrder
    || (a.ranking.latestRecentExposureOn === b.ranking.latestRecentExposureOn ? 0
      : (a.ranking.latestRecentExposureOn ?? '') > (b.ranking.latestRecentExposureOn ?? '') ? -1 : 1)
    || Number(b.ranking.activeTemplate) - Number(a.ranking.activeTemplate)
    || a.ranking.sourceOrder - b.ranking.sourceOrder)
  const selectedExercises = candidates.slice(0, query.limit)
  candidates.slice(selectedExercises.length).forEach((candidate) => {
    excludedExercises.push({ exerciseId: candidate.exerciseId, reason: 'DISPLAY_LIMIT' })
  })
  return { asOf, recentFrom, reportSelectionVersion: REPORT_SELECTION_VERSION,
    selectedExercises, excludedExercises, eligibleExerciseCount: candidates.length }
}
