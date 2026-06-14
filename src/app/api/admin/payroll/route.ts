import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { jwtVerify } from 'jose'
import { db } from '@/lib/db'
import { incentiveForVerifiedSalesInMonth } from '@/lib/incentive-tier'
import {
  attendanceKindToUnits,
  monthBoundsUtc,
  weekdayCountInMonth,
} from '@/lib/payroll-utils'
import { getJwtSecret } from '@/lib/jwt-secret'
import { verifiedInMonthFilter } from '@/lib/verified-month'

type PayrollRow = {
  employeeId: string
  name: string | null
  email: string
  employeeCode?: string | null
  baseSalaryMonthly: number | null
  approvedAttendanceUnits: number
  weekdayExpected: number
  attendanceRatio: number
  baseEarned: number | null
  verifiedSalesInMonth: number
  monthlyIncentive: number
  estimatedGross: number
}

const secret = getJwtSecret()

export async function GET(req: NextRequest) {
  const token = req.cookies.get('token')?.value
  if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  try {
    const { payload } = await jwtVerify(token, secret)
    if (payload.role !== 'ADMIN') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

    const { searchParams } = new URL(req.url)
    const now = new Date()
    let year = parseInt(searchParams.get('year') || '', 10)
    let month = parseInt(searchParams.get('month') || '', 10)
    if (!Number.isFinite(year)) year = now.getFullYear()
    if (!Number.isFinite(month)) month = now.getMonth() + 1
    // Audit LOW-2: clamp to a sane range so absurd inputs can't drive pointless queries.
    year = Math.min(now.getFullYear() + 1, Math.max(2000, year))
    month = Math.min(12, Math.max(1, month))

    const { start, end } = monthBoundsUtc(year, month)
    const wd = weekdayCountInMonth(year, month)
    const mk = `${year}-${String(month).padStart(2, '0')}`

    const employees = await db.user.findMany({
      where: { role: 'EMPLOYEE' },
      select: { id: true, name: true, email: true, employeeId: true, baseSalaryMonthly: true },
      orderBy: { name: 'asc' },
    })

    const employeeIds = employees.map((e) => e.id)

    const [verifiedGroups, attendanceRows] = await Promise.all([
      employeeIds.length
        ? db.lead.groupBy({
            by: ['assignedToId'],
            where: {
              assignedToId: { in: employeeIds },
              // Audit BUG-2: count by verifiedAt (fallback updatedAt) to match the dashboard.
              ...verifiedInMonthFilter(start, end),
            },
            _count: { _all: true },
          })
        : Promise.resolve([]),
      employeeIds.length
        ? db.attendanceEntry.findMany({
            where: {
              userId: { in: employeeIds },
              status: 'APPROVED',
              dayKey: { startsWith: mk },
            },
            select: { userId: true, kind: true },
          })
        : Promise.resolve([]),
    ])

    const verifiedMap = new Map<string, number>()
    for (const g of verifiedGroups) {
      if (g.assignedToId) verifiedMap.set(g.assignedToId, g._count._all)
    }

    const attendanceMap = new Map<string, number>()
    for (const a of attendanceRows) {
      attendanceMap.set(a.userId, (attendanceMap.get(a.userId) ?? 0) + attendanceKindToUnits(a.kind))
    }

    const rows: PayrollRow[] = employees.map((emp) => {
      const verifiedCount = verifiedMap.get(emp.id) ?? 0
      const incentive = incentiveForVerifiedSalesInMonth(verifiedCount)
      const units = attendanceMap.get(emp.id) ?? 0
      const ratio = Math.min(Math.max(units, 0) / wd, 1)
      const base = emp.baseSalaryMonthly
      const baseEarn =
        base != null && Number.isFinite(base) ? Math.round(base * ratio * 100) / 100 : null
      const gross = (baseEarn ?? 0) + incentive

      return {
        employeeId: emp.id,
        name: emp.name,
        email: emp.email,
        employeeCode: emp.employeeId,
        baseSalaryMonthly: base,
        approvedAttendanceUnits: Math.round(units * 100) / 100,
        weekdayExpected: wd,
        attendanceRatio: Math.round(ratio * 1000) / 1000,
        baseEarned: baseEarn,
        verifiedSalesInMonth: verifiedCount,
        monthlyIncentive: incentive,
        estimatedGross: Math.round(gross * 100) / 100,
      }
    })

    return NextResponse.json({
      year,
      month,
      incentiveTiers: {
        1: 3000,
        2: 7000,
        3: 11000,
        4: 16000,
        5: 25000,
      },
      rows,
    })
  } catch (e) {
    console.error(e)
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}
