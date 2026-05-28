import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { jwtVerify } from 'jose'
import { db } from '@/lib/db'
import { getLeadUpdatedAtRangeFromRequest } from '@/lib/adminDateRange'
import { buildEmployeeLeaderboard } from '@/lib/admin-aggregations'
import { getJwtSecret } from '@/lib/jwt-secret'

const secret = getJwtSecret()

export async function GET(req: NextRequest) {
  const token = req.cookies.get('token')?.value
  if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  try {
    const { payload } = await jwtVerify(token, secret)
    if (payload.role !== 'ADMIN') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

    const range = getLeadUpdatedAtRangeFromRequest(req)
    const u = range ? { updatedAt: { gte: range.gte, lte: range.lte } } : {}

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
    ] = await Promise.all([
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
    ])

    return NextResponse.json({
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
    })
  } catch (error) {
    console.error('[admin/metrics]', error)
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}
