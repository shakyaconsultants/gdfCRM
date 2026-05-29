import type { Prisma } from '@prisma/client'
import type { PrismaClient } from '@prisma/client'
import { logQueryTiming } from '@/lib/query-timing-log'

const PROFILE_SCOPE = 'DASHBOARD PROFILE'

type CountByAssignee = { assigneeId: string; count: number }[]

function mapGroupByAssignedTo(
  rows: { assignedToId: string | null; _count: { _all: number } }[]
): CountByAssignee {
  return rows
    .filter((r): r is { assignedToId: string; _count: { _all: number } } => !!r.assignedToId)
    .map((r) => ({ assigneeId: r.assignedToId, count: r._count._all }))
}

function mapGroupByAdvisor(
  rows: { assignedAdvisorId: string | null; _count: { _all: number } }[]
): CountByAssignee {
  return rows
    .filter((r): r is { assignedAdvisorId: string; _count: { _all: number } } => !!r.assignedAdvisorId)
    .map((r) => ({ assigneeId: r.assignedAdvisorId, count: r._count._all }))
}

function mapGroupByAssessor(
  rows: { assignedCaseAssessorId: string | null; _count: { _all: number } }[]
): CountByAssignee {
  return rows
    .filter(
      (r): r is { assignedCaseAssessorId: string; _count: { _all: number } } =>
        !!r.assignedCaseAssessorId
    )
    .map((r) => ({ assigneeId: r.assignedCaseAssessorId, count: r._count._all }))
}

function countMap(rows: CountByAssignee): Map<string, number> {
  return new Map(rows.map((r) => [r.assigneeId, r.count]))
}

export async function buildEmployeeLeaderboard(
  db: PrismaClient,
  leadWhere: Prisma.LeadWhereInput
) {
  const start = Date.now()
  const employees = await db.user.findMany({
    where: { role: 'EMPLOYEE' },
    select: { id: true, name: true },
    orderBy: { name: 'asc' },
  })

  const baseWhere: Prisma.LeadWhereInput = {
    assignedToId: { not: null },
    ...leadWhere,
  }

  const [droppedRows, verifiedRows, clawbackRows] = await Promise.all([
    db.lead.groupBy({
      by: ['assignedToId'],
      where: { ...baseWhere, closedSale: true },
      _count: { _all: true },
    }),
    db.lead.groupBy({
      by: ['assignedToId'],
      where: { ...baseWhere, verifiedSale: true },
      _count: { _all: true },
    }),
    db.lead.groupBy({
      by: ['assignedToId'],
      where: { ...baseWhere, caseStatus: 'CLAWBACK' },
      _count: { _all: true },
    }),
  ])

  const dropped = countMap(mapGroupByAssignedTo(droppedRows))
  const verified = countMap(mapGroupByAssignedTo(verifiedRows))
  const clawback = countMap(mapGroupByAssignedTo(clawbackRows))

  const result = employees
    .map((emp) => ({
      name: emp.name,
      droppedCount: dropped.get(emp.id) ?? 0,
      verifiedCount: verified.get(emp.id) ?? 0,
      clawbackCount: clawback.get(emp.id) ?? 0,
    }))
    .sort(
      (a, b) =>
        b.verifiedCount - a.verifiedCount ||
        b.droppedCount - a.droppedCount ||
        b.clawbackCount - a.clawbackCount
    )
  logQueryTiming(PROFILE_SCOPE, 'buildEmployeeLeaderboard', Date.now() - start, {
    employees: employees.length,
  })
  return result
}

export async function buildAdvisorPerformance(
  db: PrismaClient,
  advisors: { id: string; name: string; email: string }[],
  leadWhere: Prisma.LeadWhereInput
) {
  const start = Date.now()
  const base: Prisma.LeadWhereInput = {
    assignedAdvisorId: { not: null },
    ...leadWhere,
  }

  const [transferred, forwarded, verified, dropped, clawback] = await Promise.all([
    db.lead.groupBy({
      by: ['assignedAdvisorId'],
      where: { ...base, moveToAdvisor: true },
      _count: { _all: true },
    }),
    db.lead.groupBy({
      by: ['assignedAdvisorId'],
      where: { ...base, assignedCaseAssessorId: { not: null } },
      _count: { _all: true },
    }),
    db.lead.groupBy({
      by: ['assignedAdvisorId'],
      where: { ...base, verifiedSale: true },
      _count: { _all: true },
    }),
    db.lead.groupBy({
      by: ['assignedAdvisorId'],
      where: { ...base, closedSale: true },
      _count: { _all: true },
    }),
    db.lead.groupBy({
      by: ['assignedAdvisorId'],
      where: { ...base, caseStatus: 'CLAWBACK' },
      _count: { _all: true },
    }),
  ])

  const t = countMap(mapGroupByAdvisor(transferred))
  const f = countMap(mapGroupByAdvisor(forwarded))
  const v = countMap(mapGroupByAdvisor(verified))
  const d = countMap(mapGroupByAdvisor(dropped))
  const c = countMap(mapGroupByAdvisor(clawback))

  const result = advisors
    .map((a) => ({
      id: a.id,
      name: a.name,
      email: a.email,
      transferredFromEmployee: t.get(a.id) ?? 0,
      forwardedToCaseAssessor: f.get(a.id) ?? 0,
      verified: v.get(a.id) ?? 0,
      dropped: d.get(a.id) ?? 0,
      clawback: c.get(a.id) ?? 0,
    }))
    .sort(
      (a, b) =>
        b.verified - a.verified ||
        b.dropped - a.dropped ||
        b.clawback - a.clawback ||
        b.forwardedToCaseAssessor - a.forwardedToCaseAssessor
    )
  logQueryTiming(PROFILE_SCOPE, 'buildAdvisorPerformance', Date.now() - start, {
    advisors: advisors.length,
  })
  return result
}

export async function buildAssessorPerformance(
  db: PrismaClient,
  assessors: { id: string; name: string; email: string }[],
  leadWhere: Prisma.LeadWhereInput
) {
  const start = Date.now()
  const base: Prisma.LeadWhereInput = {
    assignedCaseAssessorId: { not: null },
    ...leadWhere,
  }

  const [assigned, verified, dropped, clawback, payments] = await Promise.all([
    db.lead.groupBy({
      by: ['assignedCaseAssessorId'],
      where: base,
      _count: { _all: true },
    }),
    db.lead.groupBy({
      by: ['assignedCaseAssessorId'],
      where: { ...base, verifiedSale: true },
      _count: { _all: true },
    }),
    db.lead.groupBy({
      by: ['assignedCaseAssessorId'],
      where: { ...base, closedSale: true },
      _count: { _all: true },
    }),
    db.lead.groupBy({
      by: ['assignedCaseAssessorId'],
      where: { ...base, caseStatus: 'CLAWBACK' },
      _count: { _all: true },
    }),
    db.lead.groupBy({
      by: ['assignedCaseAssessorId'],
      where: { ...base, paymentReceived: true },
      _count: { _all: true },
    }),
  ])

  const a = countMap(mapGroupByAssessor(assigned))
  const v = countMap(mapGroupByAssessor(verified))
  const d = countMap(mapGroupByAssessor(dropped))
  const c = countMap(mapGroupByAssessor(clawback))
  const p = countMap(mapGroupByAssessor(payments))

  const result = assessors
    .map((s) => ({
      id: s.id,
      name: s.name,
      email: s.email,
      assignedTotal: a.get(s.id) ?? 0,
      verified: v.get(s.id) ?? 0,
      dropped: d.get(s.id) ?? 0,
      clawback: c.get(s.id) ?? 0,
      payments: p.get(s.id) ?? 0,
    }))
    .sort(
      (x, y) =>
        y.verified - x.verified || y.dropped - x.dropped || y.clawback - x.clawback
    )
  logQueryTiming(PROFILE_SCOPE, 'buildAssessorPerformance', Date.now() - start, {
    assessors: assessors.length,
  })
  return result
}
