import type { Prisma } from '@prisma/client'
import type { PrismaClient } from '@prisma/client'
import { LEAD_DISPOSITIONS } from '@/lib/lead-workflow'

/** Default disposition for imports and fresh unassigned pool. */
export const FRESH_UNASSIGNED_DISPOSITION = LEAD_DISPOSITIONS[0]

const DEFAULT_DISPOSITION = FRESH_UNASSIGNED_DISPOSITION

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

/** Leads with no employee owner (null or field absent). */
export function unassignedEmployeeWhere(): Prisma.LeadWhereInput {
  return {
    OR: [{ assignedToId: null }, { assignedToId: { isSet: false } }],
  }
}

/** Unassigned leads whose disposition is not New — should be normalized back to the assignable pool. */
export function unassignedNonNewDispositionWhere(): Prisma.LeadWhereInput {
  return {
    AND: [
      unassignedEmployeeWhere(),
      { disposition: { not: FRESH_UNASSIGNED_DISPOSITION } },
    ],
  }
}

/** Reset disposition to New for all unassigned leads (repairs legacy / orphaned rows). */
export async function normalizeUnassignedLeadDispositions(db: PrismaClient) {
  return db.lead.updateMany({
    where: unassignedNonNewDispositionWhere(),
    data: {
      disposition: FRESH_UNASSIGNED_DISPOSITION,
      updatedAt: new Date(),
    },
  })
}

/** No employee owner — assignable fresh pool also requires New disposition (see admin unassigned filter). */
export function isTotallyUnassignedLead(lead: {
  assignedToId?: string | null
  disposition?: string | null
}): boolean {
  const noEmployee = !lead.assignedToId || lead.assignedToId === ''
  const fresh =
    !lead.disposition || lead.disposition === FRESH_UNASSIGNED_DISPOSITION
  return noEmployee && fresh
}
