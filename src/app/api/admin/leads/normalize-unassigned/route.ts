import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { jwtVerify } from 'jose'
import { db } from '@/lib/db'
import { getJwtSecret } from '@/lib/jwt-secret'
import { normalizeUnassignedLeadDispositions } from '@/lib/lead-assignment'
import { invalidateCountCache } from '@/lib/admin-leads-count-cache'
import { invalidateAdminDashboardCache } from '@/lib/admin-dashboard-cache'
import { refreshDashboardStatsAfterLeadMutation } from '@/lib/dashboard-stats-snapshot'

const secret = getJwtSecret()
const LOG_SCOPE = 'ADMIN LEADS NORMALIZE'

export const preferredRegion = 'bom1'
export const runtime = 'nodejs'
export const maxDuration = 120

export async function POST(_req: NextRequest) {
  const token = _req.cookies.get('token')?.value
  if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  try {
    const { payload } = await jwtVerify(token, secret)
    if (payload.role !== 'ADMIN') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

    const repaired = await normalizeUnassignedLeadDispositions(db)
    if (repaired.count > 0) {
      invalidateCountCache()
      invalidateAdminDashboardCache()
      void refreshDashboardStatsAfterLeadMutation()
      console.log(`[${LOG_SCOPE}] fixed ${repaired.count} unassigned lead(s) → disposition New`)
    }

    return NextResponse.json({
      success: true,
      repairedCount: repaired.count,
    })
  } catch (error) {
    console.error(`[${LOG_SCOPE}]`, error)
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}
