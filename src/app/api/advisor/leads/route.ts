import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { jwtVerify } from 'jose'
import { db } from '@/lib/db'
import { paginationFromRequest, parseSinceParam } from '@/lib/api-pagination'
import { countAssignedLeadStatsCached } from '@/lib/lead-assigned-stats'
import { ADVISOR_LEAD_LIST_SELECT } from '@/lib/lead-list-selects'
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

    if (payload.role !== 'ADVISOR') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const baseWhere = {
      assignedAdvisorId: userId,
      moveToAdvisor: true,
    }

    const since = parseSinceParam(req.nextUrl.searchParams.get('since'))
    if (since) {
      const deltas = await db.lead.findMany({
        where: { ...baseWhere, updatedAt: { gt: since } },
        select: ADVISOR_LEAD_LIST_SELECT,
        orderBy: { updatedAt: 'desc' },
        take: DELTA_TAKE,
      })
      return NextResponse.json({
        deltas,
        serverTime: new Date().toISOString(),
      })
    }

    const search = req.nextUrl.searchParams.get('search') ?? ''
    const includeStats = req.nextUrl.searchParams.get('stats') === 'true'
    const { page, pageSize, skip } = paginationFromRequest(req, {
      pageSize: 50,
      maxPageSize: 100,
    })

    const where = mergeLeadWhere(baseWhere, leadSearchFilter(search))

    const [total, leads, stats] = await Promise.all([
      db.lead.count({ where }),
      db.lead.findMany({
        where,
        select: ADVISOR_LEAD_LIST_SELECT,
        orderBy: { updatedAt: 'desc' },
        skip,
        take: pageSize,
      }),
      includeStats
        ? Promise.all([
            countAssignedLeadStatsCached(db, baseWhere, `adv:${userId}`),
            db.lead.count({
              where: { ...baseWhere, assignedCaseAssessorId: { not: null } },
            }),
          ]).then(([s, forwarded]) => ({
            transferredFromEmployee: s.total,
            dropped: s.dropped,
            forwardedToCaseAssessor: forwarded,
            verified: s.verified,
            clawback: s.clawbacks,
          }))
        : Promise.resolve(undefined),
    ])

    return NextResponse.json({
      leads,
      total,
      page,
      pageSize,
      totalPages: Math.max(1, Math.ceil(total / pageSize)),
      stats,
      serverTime: new Date().toISOString(),
    })
  } catch (error) {
    console.error('[advisor/leads]', error)
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}
