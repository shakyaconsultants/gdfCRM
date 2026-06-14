import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { jwtVerify } from 'jose'
import { db } from '@/lib/db'
import { getJwtSecret } from '@/lib/jwt-secret'

const secret = getJwtSecret()
const ATTENDANCE_CAP = 2000

const PREFIX_RE = /^(\d{4})-(\d{2})$/

function resolveMonth(search: URLSearchParams): string {
  const m = search.get('month')
  const now = new Date()
  const def = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
  if (!m || !PREFIX_RE.test(m)) return def
  return m
}

export async function GET(req: NextRequest) {
  const token = req.cookies.get('token')?.value
  if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  try {
    const { payload } = await jwtVerify(token, secret)
    if (payload.role !== 'ADMIN') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

    const prefix = resolveMonth(req.nextUrl.searchParams)
    const where = { dayKey: { startsWith: prefix } }
    // Audit PERF-6: report real total + an explicit cap instead of a silent truncation.
    const [total, rows] = await Promise.all([
      db.attendanceEntry.count({ where }),
      db.attendanceEntry.findMany({
        where,
        include: { user: { select: { name: true, email: true, employeeId: true } } },
        orderBy: [{ dayKey: 'asc' }, { userId: 'asc' }],
        take: ATTENDANCE_CAP,
      }),
    ])
    return NextResponse.json({
      month: prefix,
      attendance: rows,
      total,
      cap: ATTENDANCE_CAP,
      truncated: total > rows.length,
    })
  } catch (error) {
    console.error('[admin/attendance]', error)
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}
