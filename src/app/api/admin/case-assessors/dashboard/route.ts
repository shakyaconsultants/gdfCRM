import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { jwtVerify } from 'jose'
import { db } from '@/lib/db'
import { getLeadUpdatedAtRangeFromRequest } from '@/lib/adminDateRange'
import { buildAssessorPerformance } from '@/lib/admin-aggregations'
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

    const assessors = await db.user.findMany({
      where: { role: 'CASE_ASSESSOR' },
      select: { id: true, name: true, email: true, createdAt: true },
      orderBy: { name: 'asc' },
    })

    const perAssessor = await buildAssessorPerformance(db, assessors, u)

    const totalAssignedLeads = await db.lead.count({
      where: { assignedCaseAssessorId: { not: null }, ...u },
    })

    return NextResponse.json({
      assessorCount: assessors.length,
      totalAssignedLeads,
      perAssessor,
      range: range
        ? { from: range.gte.toISOString().slice(0, 10), to: range.lte.toISOString().slice(0, 10) }
        : null,
    })
  } catch (error) {
    console.error(error)
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}
