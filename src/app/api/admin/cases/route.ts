import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { jwtVerify } from 'jose'
import { db } from '@/lib/db'
import { paginationFromRequest } from '@/lib/api-pagination'
import { ADMIN_CASE_LIST_SELECT } from '@/lib/lead-list-selects'
import { getJwtSecret } from '@/lib/jwt-secret'

const secret = getJwtSecret()

export async function GET(req: NextRequest) {
  const token = req.cookies.get('token')?.value
  if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  try {
    const { payload } = await jwtVerify(token, secret)
    if (payload.role !== 'ADMIN') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

    const where = { assignedCaseAssessorId: { not: null } }
    const { page, pageSize, skip } = paginationFromRequest(req, {
      pageSize: 50,
      maxPageSize: 100,
    })

    const [total, cases] = await Promise.all([
      db.lead.count({ where }),
      db.lead.findMany({
        where,
        select: ADMIN_CASE_LIST_SELECT,
        orderBy: { updatedAt: 'desc' },
        skip,
        take: pageSize,
      }),
    ])

    return NextResponse.json({
      cases,
      total,
      page,
      pageSize,
      totalPages: Math.max(1, Math.ceil(total / pageSize)),
    })
  } catch (error) {
    console.error(error)
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}
