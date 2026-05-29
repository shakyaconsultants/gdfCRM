import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { jwtVerify } from 'jose'
import { getDashboardRequestContext } from '@/lib/adminDateRange'
import { getJwtSecret } from '@/lib/jwt-secret'
import {
  getAdminDashboardCache,
  setAdminDashboardCache,
} from '@/lib/admin-dashboard-cache'
import { getDashboardFromSnapshot } from '@/lib/dashboard-stats-snapshot'
import { logQueryTiming } from '@/lib/query-timing-log'

export const preferredRegion = 'bom1'

const secret = getJwtSecret()
const LOG_SCOPE = 'ADMIN DASHBOARD'

/** Single admin dashboard payload — reads precomputed snapshot when available. */
export async function GET(req: NextRequest) {
  const token = req.cookies.get('token')?.value
  if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const reqStart = Date.now()

  try {
    const { payload } = await jwtVerify(token, secret)
    if (payload.role !== 'ADMIN') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

    const { range, scopeKey, cacheKey, fromKey, toKey } = getDashboardRequestContext(req)
    const logMeta = {
      from: fromKey ?? 'all',
      to: toKey ?? 'all',
      scope: scopeKey,
    }

    const cached = getAdminDashboardCache(cacheKey)
    if (cached != null) {
      logQueryTiming(LOG_SCOPE, 'GET total (memory CACHE HIT)', Date.now() - reqStart, logMeta)
      const response = NextResponse.json(cached)
      response.headers.set('Cache-Control', 'private, max-age=300')
      return response
    }

    const { payload: dashboardPayload, source } = await getDashboardFromSnapshot(scopeKey, range)
    setAdminDashboardCache(cacheKey, dashboardPayload)

    const label =
      source === 'cold-build'
        ? 'GET total (cold build — expect ~5s once)'
        : `GET total (snapshot CACHE HIT)`
    logQueryTiming(LOG_SCOPE, label, Date.now() - reqStart, logMeta)

    const response = NextResponse.json(dashboardPayload)
    response.headers.set('Cache-Control', 'private, max-age=300')
    return response
  } catch (error) {
    console.error('[admin/dashboard]', error)
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}
