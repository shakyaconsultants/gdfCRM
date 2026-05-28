import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { jwtVerify } from 'jose'
import { db } from '@/lib/db'
import { getLeadUpdatedAtRangeFromRequest } from '@/lib/adminDateRange'
import { paginationFromRequest, parseSinceParam } from '@/lib/api-pagination'
import { CASE_ASSESSOR_LEAD_LIST_SELECT } from '@/lib/lead-list-selects'
import { mapCaseAssessorListRow } from '@/lib/lead-list-mapper'
import { leadSearchFilter, mergeLeadWhere } from '@/lib/lead-search-filter'
import { getJwtSecret } from '@/lib/jwt-secret'

const secret = getJwtSecret()
const DELTA_TAKE = 100

export async function GET(req: NextRequest) {
  const token = req.cookies.get('token')?.value
  if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  try {
    const { payload } = await jwtVerify(token, secret)
    const userId = payload.id as string

    if (payload.role !== 'CASE_ASSESSOR') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const range = getLeadUpdatedAtRangeFromRequest(req)
    const updatedFilter = range ? { updatedAt: { gte: range.gte, lte: range.lte } } : {}
    const baseWhere = { assignedCaseAssessorId: userId, ...updatedFilter }

    const since = parseSinceParam(req.nextUrl.searchParams.get('since'))
    if (since) {
      const deltaRows = await db.lead.findMany({
        where: { ...baseWhere, updatedAt: { gt: since } },
        select: { ...CASE_ASSESSOR_LEAD_LIST_SELECT, caseChecklist: true },
        orderBy: { updatedAt: 'desc' },
        take: DELTA_TAKE,
      })
      return NextResponse.json({
        deltas: deltaRows.map(mapCaseAssessorListRow),
        serverTime: new Date().toISOString(),
      })
    }

    const search = req.nextUrl.searchParams.get('search') ?? ''
    const { page, pageSize, skip } = paginationFromRequest(req, {
      pageSize: 50,
      maxPageSize: 100,
    })

    const where = mergeLeadWhere(baseWhere, leadSearchFilter(search))

    const [total, rows] = await Promise.all([
      db.lead.count({ where }),
      db.lead.findMany({
        where,
        select: { ...CASE_ASSESSOR_LEAD_LIST_SELECT, caseChecklist: true },
        orderBy: { updatedAt: 'desc' },
        skip,
        take: pageSize,
      }),
    ])

    return NextResponse.json({
      leads: rows.map(mapCaseAssessorListRow),
      total,
      page,
      pageSize,
      totalPages: Math.max(1, Math.ceil(total / pageSize)),
      range: range
        ? { from: range.gte.toISOString().slice(0, 10), to: range.lte.toISOString().slice(0, 10) }
        : null,
      serverTime: new Date().toISOString(),
    })
  } catch {
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}
