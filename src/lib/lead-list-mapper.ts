import { caseChecklistHasData } from '@/lib/lead-workflow'

/** Strip heavy JSON from assessor list rows; expose hasChecklist flag only. */
export function mapCaseAssessorListRow<T extends { caseChecklist?: unknown }>(
  row: T
): Omit<T, 'caseChecklist'> & { hasChecklist: boolean } {
  const { caseChecklist, ...rest } = row
  return { ...rest, hasChecklist: caseChecklistHasData(caseChecklist) }
}
