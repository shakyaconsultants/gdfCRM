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

const secret = getJwtSecret()

/** Single admin dashboard payload — replaces 3 parallel client requests. */
export async function GET(req: NextRequest) {
  const token = req.cookies.get('token')?.value
  if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  try {
    const { payload } = await jwtVerify(token, secret)
    if (payload.role !== 'ADMIN') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

    const range = getLeadUpdatedAtRangeFromRequest(req)
    const u = range ? { updatedAt: { gte: range.gte, lte: range.lte } } : {}

    const [advisors, assessors, metricsBundle] = await Promise.all([
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
        buildEmployeeLeaderboard(db, u),
      ]),
    ])

    const [
      totalLeads,
      moveCount,
      droppedCount,
      verifiedCount,
      clawbackCount,
      paymentCount,
      totalCalls,
      recentActivity,
      leaderboard,
    ] = metricsBundle

    const [perAdvisor, perAssessor, totalAssignedLeads] = await Promise.all([
      buildAdvisorPerformance(db, advisors, u),
      buildAssessorPerformance(db, assessors, u),
      db.lead.count({ where: { assignedCaseAssessorId: { not: null }, ...u } }),
    ])

    const response = NextResponse.json({
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
    })
    response.headers.set('Cache-Control', 'private, max-age=30')
    return response
  } catch (error) {
    console.error('[admin/dashboard]', error)
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}
