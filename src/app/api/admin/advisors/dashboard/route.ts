import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { jwtVerify } from 'jose'
import { db } from '@/lib/db'
import { getLeadUpdatedAtRangeFromRequest } from '@/lib/adminDateRange'
import { buildAdvisorPerformance } from '@/lib/admin-aggregations'
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

    const advisors = await db.user.findMany({
      where: { role: 'ADVISOR' },
      select: { id: true, name: true, email: true, createdAt: true },
      orderBy: { name: 'asc' },
    })

    const perAdvisor = await buildAdvisorPerformance(db, advisors, u)

    const totalTransferredFromEmployee = perAdvisor.reduce((s, p) => s + p.transferredFromEmployee, 0)
    const totalForwardedToCaseAssessor = perAdvisor.reduce((s, p) => s + p.forwardedToCaseAssessor, 0)
    const totalDropped = perAdvisor.reduce((s, p) => s + p.dropped, 0)
    const totalVerified = perAdvisor.reduce((s, p) => s + p.verified, 0)
    const totalClawback = perAdvisor.reduce((s, p) => s + p.clawback, 0)

    return NextResponse.json({
      advisorCount: advisors.length,
      totalTransferredFromEmployee,
      totalForwardedToCaseAssessor,
      totalDropped,
      totalVerified,
      totalClawback,
      perAdvisor,
      range: range
        ? { from: range.gte.toISOString().slice(0, 10), to: range.lte.toISOString().slice(0, 10) }
        : null,
    })
  } catch (error) {
    console.error(error)
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}
