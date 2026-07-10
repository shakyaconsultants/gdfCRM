import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { enforceEmployeeWithCrm } from '@/lib/enforce-employee-auth'
import { paginationFromRequest, parseSinceParam } from '@/lib/api-pagination'
import { countAssignedLeadStatsCached } from '@/lib/lead-assigned-stats'
import { EMPLOYEE_LEAD_LIST_SELECT } from '@/lib/lead-list-selects'
import { leadSearchFilter, mergeLeadWhere } from '@/lib/lead-search-filter'
import { getLeadAssignedDateRange } from '@/lib/adminDateRange'
import { LEAD_DISPOSITIONS } from '@/lib/lead-workflow'

const DELTA_TAKE = 100
const ALLOWED_DISPOSITIONS = new Set<string>(LEAD_DISPOSITIONS)

export async function GET(req: NextRequest) {
  const gated = await enforceEmployeeWithCrm(req)
  if (gated instanceof NextResponse) return gated

  try {
    const baseWhere = { assignedToId: gated.userId }
    const since = parseSinceParam(req.nextUrl.searchParams.get('since'))

    if (since) {
      const includeStats = req.nextUrl.searchParams.get('stats') === 'true'
      const deltas = await db.lead.findMany({
        where: { ...baseWhere, updatedAt: { gt: since } },
        select: EMPLOYEE_LEAD_LIST_SELECT,
        orderBy: { updatedAt: 'desc' },
        take: DELTA_TAKE,
      })
      const [total, stats] = includeStats
        ? await Promise.all([
            db.lead.count({ where: baseWhere }),
            countAssignedLeadStatsCached(db, baseWhere, `emp:${gated.userId}`),
          ])
        : [undefined, undefined]
      const response = NextResponse.json({
        deltas,
        ...(includeStats && typeof total === 'number' ? { total } : {}),
        ...(includeStats && stats ? { stats } : {}),
        serverTime: new Date().toISOString(),
      })
      response.headers.set('Cache-Control', 'no-store')
      return response
    }

    const dispositionParam = req.nextUrl.searchParams.get('disposition') ?? 'All'
    // Audit SEC-9: only filter by a known disposition; otherwise treat as "All".
    const disposition =
      dispositionParam !== 'All' && ALLOWED_DISPOSITIONS.has(dispositionParam)
        ? dispositionParam
        : 'All'
    const search = req.nextUrl.searchParams.get('search') ?? ''
    const includeStats = req.nextUrl.searchParams.get('stats') === 'true'
    const { page, pageSize, skip } = paginationFromRequest(req, {
      pageSize: 50,
      maxPageSize: 100,
    })

    const assignedRange = getLeadAssignedDateRange(req.nextUrl.searchParams)
    const assignedDateFilter = assignedRange
      ? { assignedDate: { gte: assignedRange.gte, lte: assignedRange.lte } }
      : undefined

    const where = mergeLeadWhere(
      baseWhere,
      assignedDateFilter,
      disposition !== 'All' ? { disposition } : undefined,
      leadSearchFilter(search)
    )

    const statsWhere = assignedDateFilter
      ? mergeLeadWhere(baseWhere, assignedDateFilter)
      : baseWhere
    const statsCacheKey = assignedRange
      ? `emp:${gated.userId}:${req.nextUrl.searchParams.get('assignedFrom')}:${req.nextUrl.searchParams.get('assignedTo')}`
      : `emp:${gated.userId}`

    const [total, leads, stats] = await Promise.all([
      db.lead.count({ where }),
      db.lead.findMany({
        where,
        select: EMPLOYEE_LEAD_LIST_SELECT,
        orderBy: { assignedDate: 'desc' },
        skip,
        take: pageSize,
      }),
      includeStats
        ? countAssignedLeadStatsCached(db, statsWhere, statsCacheKey)
        : Promise.resolve(undefined),
    ])

    const response = NextResponse.json({
      leads,
      total,
      page,
      pageSize,
      totalPages: Math.max(1, Math.ceil(total / pageSize)),
      stats,
      serverTime: new Date().toISOString(),
    })
    response.headers.set('Cache-Control', 'no-store')
    return response
  } catch (error) {
    console.error('[employee/leads]', error)
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}
