import type { Prisma } from '@prisma/client'
import type { PrismaClient } from '@prisma/client'
import {
  buildAdvisorPerformance,
  buildAssessorPerformance,
  buildEmployeeLeaderboard,
} from '@/lib/admin-aggregations'
import { logQueryTiming, timed } from '@/lib/query-timing-log'

const LOG_SCOPE = 'ADMIN DASHBOARD'

export type AdminDashboardPayload = {
  metrics: {
    totalLeads: number
    moveCount: number
    droppedCount: number
    verifiedCount: number
    clawbackCount: number
    paymentCount: number
    totalCalls: number
    recentActivity: unknown[]
    leaderboard: unknown[]
    range: { from: string; to: string } | null
  }
  advisors: {
    advisorCount: number
    totalTransferredFromEmployee: number
    totalForwardedToCaseAssessor: number
    totalDropped: number
    totalVerified: number
    totalClawback: number
    perAdvisor: unknown[]
    range: { from: string; to: string } | null
  }
  assessors: {
    assessorCount: number
    totalAssignedLeads: number
    perAssessor: unknown[]
    range: { from: string; to: string } | null
  }
}

type BuildOptions = {
  background?: boolean
  logMeta?: Record<string, string | number | boolean>
}

async function runTimed<T>(
  label: string,
  fn: () => Promise<T>,
  meta: Record<string, string | number | boolean>,
  background: boolean
): Promise<T> {
  if (background) return fn()
  return timed(LOG_SCOPE, label, fn, meta)
}

/** Live dashboard aggregation — 24+ DB ops; only on cold build or background refresh. */
export async function buildAdminDashboardPayload(
  db: PrismaClient,
  range: { gte: Date; lte: Date } | null,
  options?: BuildOptions | Record<string, string | number | boolean>
): Promise<AdminDashboardPayload> {
  const opts: BuildOptions =
    options && ('background' in options || 'logMeta' in options)
      ? (options as BuildOptions)
      : { logMeta: options as Record<string, string | number | boolean> | undefined }
  const background = opts.background ?? false
  const meta = opts.logMeta ?? {}
  const u: Prisma.LeadWhereInput = range ? { updatedAt: { gte: range.gte, lte: range.lte } } : {}

  const [advisors, assessors] = await runTimed(
    'load advisors/assessors',
    () =>
      Promise.all([
        db.user.findMany({
          where: { role: 'ADVISOR' },
          select: { id: true, name: true, email: true },
          orderBy: { name: 'asc' },
        }),
        db.user.findMany({
          where: { role: 'CASE_ASSESSOR' },
          select: { id: true, name: true, email: true },
          orderBy: { name: 'asc' },
        }),
      ]),
    meta,
    background
  )

  const [
    totalLeads,
    moveCount,
    droppedCount,
    verifiedCount,
    clawbackCount,
    paymentCount,
    totalCalls,
    recentActivity,
  ] = await runTimed(
    'kpi counts + recent activity',
    () =>
      Promise.all([
        db.lead.count({ where: u }),
        db.lead.count({ where: { moveToAdvisor: true, ...u } }),
        db.lead.count({ where: { closedSale: true, ...u } }),
        db.lead.count({ where: { verifiedSale: true, ...u } }),
        db.lead.count({ where: { caseStatus: 'CLAWBACK', ...u } }),
        db.lead.count({ where: { paymentReceived: true, ...u } }),
        db.lead.count({ where: { disposition: { not: 'New' }, ...u } }),
        db.lead.findMany({
          where: { disposition: { not: 'New' }, ...u },
          take: 5,
          orderBy: { updatedAt: 'desc' },
          select: {
            id: true,
            firstName: true,
            lastName: true,
            disposition: true,
            updatedAt: true,
            assignedTo: { select: { name: true } },
          },
        }),
      ]),
    meta,
    background
  )

  const leaderboard = await runTimed(
    'buildEmployeeLeaderboard',
    () => buildEmployeeLeaderboard(db, u),
    meta,
    background
  )

  const perAdvisor = await runTimed(
    'buildAdvisorPerformance',
    () => buildAdvisorPerformance(db, advisors, u),
    meta,
    background
  )

  const perAssessor = await runTimed(
    'buildAssessorPerformance',
    () => buildAssessorPerformance(db, assessors, u),
    meta,
    background
  )

  const totalAssignedLeads = await runTimed(
    'assessor assigned count',
    () => db.lead.count({ where: { assignedCaseAssessorId: { not: null }, ...u } }),
    meta,
    background
  )

  const fromLabel = meta.from && meta.from !== 'all' ? String(meta.from) : null
  const toLabel = meta.to && meta.to !== 'all' ? String(meta.to) : null
  const rangePayload =
    fromLabel && toLabel
      ? { from: fromLabel, to: toLabel }
      : range
        ? {
            from: range.gte.toISOString().slice(0, 10),
            to: range.lte.toISOString().slice(0, 10),
          }
        : null

  return {
    metrics: {
      totalLeads,
      moveCount,
      droppedCount,
      verifiedCount,
      clawbackCount,
      paymentCount,
      totalCalls,
      recentActivity,
      leaderboard,
      range: rangePayload,
    },
    advisors: {
      advisorCount: advisors.length,
      totalTransferredFromEmployee: perAdvisor.reduce((s, p) => s + p.transferredFromEmployee, 0),
      totalForwardedToCaseAssessor: perAdvisor.reduce((s, p) => s + p.forwardedToCaseAssessor, 0),
      totalDropped: perAdvisor.reduce((s, p) => s + p.dropped, 0),
      totalVerified: perAdvisor.reduce((s, p) => s + p.verified, 0),
      totalClawback: perAdvisor.reduce((s, p) => s + p.clawback, 0),
      perAdvisor,
      range: rangePayload,
    },
    assessors: {
      assessorCount: assessors.length,
      totalAssignedLeads,
      perAssessor,
      range: rangePayload,
    },
  }
}

export function logDashboardBuildComplete(
  ms: number,
  meta?: Record<string, string | number | boolean>
) {
  const label = meta?.background ? 'background snapshot refresh complete' : 'snapshot build complete'
  logQueryTiming(LOG_SCOPE, label, ms, meta)
}
