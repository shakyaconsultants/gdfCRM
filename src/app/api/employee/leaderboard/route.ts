import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { enforceEmployeeHub } from '@/lib/enforce-employee-auth'
import { startOfMonth, endOfMonth } from 'date-fns'
import { verifiedCountsByEmployee } from '@/lib/verified-counts-batch'

export async function GET(req: NextRequest) {
  const gated = await enforceEmployeeHub(req)
  if (gated instanceof NextResponse) return gated

  try {
    const now = new Date()
    const monthStart = startOfMonth(now)
    const monthEnd = endOfMonth(now)

    const [employees, counts] = await Promise.all([
      db.user.findMany({
        where: { role: 'EMPLOYEE' },
        select: { id: true, name: true, profileImageUrl: true },
      }),
      verifiedCountsByEmployee(db, monthStart, monthEnd),
    ])

    const withCounts = employees
      .map((e) => ({
        id: e.id,
        name: e.name,
        profileImageUrl: e.profileImageUrl,
        verifiedCount: counts.get(e.id) ?? 0,
      }))
      .sort((a, b) => b.verifiedCount - a.verifiedCount || a.name.localeCompare(b.name))

    const leaderboard = withCounts
      .slice(0, 10)
      .map((row, idx) => ({ ...row, rank: idx + 1 }))

    const response = NextResponse.json({
      leaderboard,
      month: monthStart.toISOString(),
      usingFallback: false,
    })
    // Audit LOW-3: short TTL so mid-month rank changes surface quickly.
    response.headers.set('Cache-Control', 'private, max-age=60')
    return response
  } catch (err) {
    console.error('[leaderboard]', err)
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}
