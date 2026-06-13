import type { PrismaClient } from '@prisma/client'

export const ASSIGNMENT_BATCH_ACTIONS = ['ASSIGN', 'TRANSFER', 'UNASSIGN'] as const
export type AssignmentBatchAction = (typeof ASSIGNMENT_BATCH_ACTIONS)[number]

type LeadOwnershipRow = {
  assignedToId: string | null
  importId?: string | null
}

function uniformValue<T>(values: T[]): T | null {
  if (values.length === 0) return null
  const first = values[0]
  return values.every((v) => v === first) ? first : null
}

export function inferSharedImportId(leads: LeadOwnershipRow[]): string | null {
  const ids = leads.map((l) => l.importId).filter((id): id is string => !!id)
  return uniformValue(ids)
}

export function classifyAssignmentBatch(
  leads: LeadOwnershipRow[],
  targetEmployeeId: string | null,
  unassign: boolean
): {
  action: AssignmentBatchAction
  employeeId: string | null
  previousEmployeeId: string | null
} {
  if (unassign) {
    const owners = leads.map((l) => l.assignedToId).filter((id): id is string => !!id)
    return {
      action: 'UNASSIGN',
      employeeId: null,
      previousEmployeeId: uniformValue(owners),
    }
  }

  const targetId = targetEmployeeId!
  const priorOwners = new Set(
    leads
      .map((l) => l.assignedToId)
      .filter((id): id is string => !!id && id !== targetId)
  )
  const hadUnassigned = leads.some((l) => !l.assignedToId)

  if (priorOwners.size === 1 && !hadUnassigned) {
    const [previousEmployeeId] = [...priorOwners]
    return {
      action: 'TRANSFER',
      employeeId: targetId,
      previousEmployeeId,
    }
  }

  return {
    action: 'ASSIGN',
    employeeId: targetId,
    previousEmployeeId: null,
  }
}

export async function recordLeadAssignmentBatch(
  db: PrismaClient,
  opts: {
    action: AssignmentBatchAction
    leadCount: number
    employeeId?: string | null
    previousEmployeeId?: string | null
    importId?: string | null
    performedById: string
  }
) {
  if (opts.leadCount <= 0) return

  try {
    await db.leadAssignmentBatch.create({
      data: {
        action: opts.action,
        leadCount: opts.leadCount,
        employeeId: opts.employeeId ?? null,
        previousEmployeeId: opts.previousEmployeeId ?? null,
        importId: opts.importId ?? null,
        performedById: opts.performedById,
      },
    })
  } catch (err) {
    console.warn('[LeadAssignmentBatch] failed to record batch (run prisma db push?)', err)
  }
}
