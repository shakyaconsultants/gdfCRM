import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { jwtVerify } from 'jose'
import { db } from '@/lib/db'
import { getLeadUpdatedAtRangeFromRequest } from '@/lib/adminDateRange'
import {
  buildAdvisorPerformance,
  buildAssessorPerformance,
  buildEmployeeLeaderboard,
} from '@/lib/admin-aggregations'
import { getJwtSecret } from '@/lib/jwt-secret'
import {
  adminDashboardCacheKey,
  getAdminDashboardCache,
  setAdminDashboardCache,
} from '@/lib/admin-dashboard-cache'
import { logQueryTiming, timed } from '@/lib/query-timing-log'

const secret = getJwtSecret()
const LOG_SCOPE = 'ADMIN DASHBOARD'

/** Single admin dashboard payload — replaces 3 parallel client requests. */
export async function GET(req: NextRequest) {
  const token = req.cookies.get('token')?.value
  if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const reqStart = Date.now()

  try {
    const { payload } = await jwtVerify(token, secret)
    if (payload.role !== 'ADMIN') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

    const range = getLeadUpdatedAtRangeFromRequest(req)
    const fromKey = range ? range.gte.toISOString().slice(0, 10) : null
    const toKey = range ? range.lte.toISOString().slice(0, 10) : null
    const cacheKey = adminDashboardCacheKey(fromKey, toKey)

    const cached = getAdminDashboardCache(cacheKey)
    if (cached != null) {
      logQueryTiming(LOG_SCOPE, 'GET total (cache hit)', Date.now() - reqStart, {
        from: fromKey ?? 'all',
        to: toKey ?? 'all',
      })
      const response = NextResponse.json(cached)
      response.headers.set('Cache-Control', 'private, max-age=30')
      return response
    }

    const u = range ? { updatedAt: { gte: range.gte, lte: range.lte } } : {}
    const logMeta = { from: fromKey ?? 'all', to: toKey ?? 'all' }

    const [advisors, assessors] = await timed(
      LOG_SCOPE,
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
      logMeta
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
    ] = await timed(
      LOG_SCOPE,
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
      logMeta
    )

    const leaderboard = await timed(
      LOG_SCOPE,
      'leaderboard',
      () => buildEmployeeLeaderboard(db, u),
      logMeta
    )

    const perAdvisor = await timed(
      LOG_SCOPE,
      'advisor performance',
      () => buildAdvisorPerformance(db, advisors, u),
      logMeta
    )

    const perAssessor = await timed(
      LOG_SCOPE,
      'assessor performance',
      () => buildAssessorPerformance(db, assessors, u),
      logMeta
    )

    const totalAssignedLeads = await timed(
      LOG_SCOPE,
      'assessor assigned count',
      () => db.lead.count({ where: { assignedCaseAssessorId: { not: null }, ...u } }),
      logMeta
    )

    const dashboardPayload = {
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
        range: range
          ? { from: range.gte.toISOString().slice(0, 10), to: range.lte.toISOString().slice(0, 10) }
          : null,
      },
      advisors: {
        advisorCount: advisors.length,
        totalTransferredFromEmployee: perAdvisor.reduce((s, p) => s + p.transferredFromEmployee, 0),
        totalForwardedToCaseAssessor: perAdvisor.reduce((s, p) => s + p.forwardedToCaseAssessor, 0),
        totalDropped: perAdvisor.reduce((s, p) => s + p.dropped, 0),
        totalVerified: perAdvisor.reduce((s, p) => s + p.verified, 0),
        totalClawback: perAdvisor.reduce((s, p) => s + p.clawback, 0),
        perAdvisor,
        range: range
          ? { from: range.gte.toISOString().slice(0, 10), to: range.lte.toISOString().slice(0, 10) }
          : null,
      },
      assessors: {
        assessorCount: assessors.length,
        totalAssignedLeads,
        perAssessor,
        range: range
          ? { from: range.gte.toISOString().slice(0, 10), to: range.lte.toISOString().slice(0, 10) }
          : null,
      },
    }

    setAdminDashboardCache(cacheKey, dashboardPayload)
    logQueryTiming(LOG_SCOPE, 'GET total', Date.now() - reqStart, logMeta)

    const response = NextResponse.json(dashboardPayload)
    response.headers.set('Cache-Control', 'private, max-age=30')
    return response
  } catch (error) {
    console.error('[admin/dashboard]', error)
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}
