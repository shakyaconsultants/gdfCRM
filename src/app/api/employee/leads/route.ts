import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { enforceEmployeeWithCrm } from '@/lib/enforce-employee-auth'
import { paginationFromRequest, parseSinceParam } from '@/lib/api-pagination'
import { countAssignedLeadStats } from '@/lib/lead-assigned-stats'
import { EMPLOYEE_LEAD_LIST_SELECT } from '@/lib/lead-list-selects'
import { leadSearchFilter, mergeLeadWhere } from '@/lib/lead-search-filter'

const DELTA_TAKE = 100

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
            countAssignedLeadStats(db, baseWhere),
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

    const disposition = req.nextUrl.searchParams.get('disposition') ?? 'All'
    const search = req.nextUrl.searchParams.get('search') ?? ''
    const includeStats = req.nextUrl.searchParams.get('stats') === 'true'
    const { page, pageSize, skip } = paginationFromRequest(req, {
      pageSize: 50,
      maxPageSize: 100,
    })

    const where = mergeLeadWhere(
      baseWhere,
      disposition !== 'All' ? { disposition } : undefined,
      leadSearchFilter(search)
    )

    const [total, leads, stats] = await Promise.all([
      db.lead.count({ where }),
      db.lead.findMany({
        where,
        select: EMPLOYEE_LEAD_LIST_SELECT,
        orderBy: { assignedDate: 'desc' },
        skip,
        take: pageSize,
      }),
      includeStats ? countAssignedLeadStats(db, baseWhere) : Promise.resolve(undefined),
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
  } catch {
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}
