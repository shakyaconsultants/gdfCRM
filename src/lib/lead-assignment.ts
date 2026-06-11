import { LEAD_DISPOSITIONS } from '@/lib/lead-workflow'

const DEFAULT_DISPOSITION = LEAD_DISPOSITIONS[0]

/**
 * Clears telemarketer work when ownership changes.
 * Advisor / case-assessor fields (caseStatus, checklist, assessor assignee, preSipAt,
 * verifiedSale, closedSale, etc.) are intentionally left unchanged.
 */
function resetEmployeeLeadWork() {
  return {
    disposition: DEFAULT_DISPOSITION,
    callbackAt: null,
    remarks: null,
    employeeIntakeForm: null,
    moveToAdvisor: false,
    assignedAdvisorId: null,
  }
}

/** Assign or transfer a lead to an employee — resets prior employee CRM work. */
export function employeeAssignUpdate(assignedToId: string) {
  return {
    ...resetEmployeeLeadWork(),
    assignedToId,
    assignedDate: new Date(),
    updatedAt: new Date(),
  }
}

/** Remove employee ownership — lead returns to the unassigned pool with a clean slate. */
export function employeeUnassignUpdate() {
  return {
    ...resetEmployeeLeadWork(),
    assignedToId: null,
    assignedDate: null,
    updatedAt: new Date(),
  }
}

/** Totally unassigned (no employee) — used by AUTO SELECT for first-time assignment. */
export function isTotallyUnassignedLead(lead: {
  assignedToId?: string | null
}): boolean {
  return !lead.assignedToId || lead.assignedToId === ''
}
