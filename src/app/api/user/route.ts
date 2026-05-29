import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { jwtVerify } from 'jose'
import { db } from '@/lib/db'
import { employeeHasCrmAccess, type AppJwtClaims } from '@/lib/employee-jwt'
import { CRM_SESSION_COOKIE } from '@/lib/employee-crm-session'
import { getJwtSecret } from '@/lib/jwt-secret'
import { logQueryTiming } from '@/lib/query-timing-log'

const secret = getJwtSecret()
const LOG_SCOPE = 'USER API'

export async function GET(req: NextRequest) {
  const totalStart = Date.now()
  const crmJwt = req.cookies.get(CRM_SESSION_COOKIE)?.value
  const token = req.cookies.get('token')?.value
  /** Prefer team token on workspace; CRM cookie when team session is absent. */
  const jwt = token ?? crmJwt

  if (!jwt) {
    return NextResponse.json({ user: null }, { status: 401 })
  }

  try {
    const jwtStart = Date.now()
    const { payload } = await jwtVerify(jwt, secret)
    logQueryTiming(LOG_SCOPE, 'jwt verify', Date.now() - jwtStart)

    const p = payload as AppJwtClaims
    const prismaStart = Date.now()
    const user = await db.user.findUnique({
      where: { id: payload.id as string },
      select: {
        id: true,
        email: true,
        role: true,
        name: true,
        profileImageUrl: true,
      },
    })
    logQueryTiming(LOG_SCOPE, 'prisma query', Date.now() - prismaStart, {
      userId: String(payload.id ?? '').slice(0, 8),
    })

    if (!user) {
      logQueryTiming(LOG_SCOPE, 'total', Date.now() - totalStart, { status: 401 })
      return NextResponse.json({ user: null }, { status: 401 })
    }
    const response = NextResponse.json({
      user: {
        id: user.id,
        email: user.email,
        role: user.role,
        name: user.name,
        profileImageUrl: user.profileImageUrl,
        crmAccess: user.role === 'EMPLOYEE' ? employeeHasCrmAccess(p) : true,
      },
    })
    response.headers.set('Cache-Control', 'private, max-age=120')
    logQueryTiming(LOG_SCOPE, 'total', Date.now() - totalStart, { status: 200 })
    return response
  } catch {
    logQueryTiming(LOG_SCOPE, 'total', Date.now() - totalStart, { status: 401, error: true })
    return NextResponse.json({ user: null }, { status: 401 })
  }
}
