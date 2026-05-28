import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { enforceEmployeeWithCrm } from '@/lib/enforce-employee-auth'

export async function GET(req: NextRequest) {
  const gated = await enforceEmployeeWithCrm(req)
  if (gated instanceof NextResponse) return gated

  try {
    const advisors = await db.user.findMany({
      where: { role: 'ADVISOR' },
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
    })

    const response = NextResponse.json({ advisors })
    response.headers.set('Cache-Control', 'private, max-age=600')
    return response
  } catch {
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}
