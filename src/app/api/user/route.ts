import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { jwtVerify } from 'jose'
import { db } from '@/lib/db'
import { employeeHasCrmAccess, type AppJwtClaims } from '@/lib/employee-jwt'
import { CRM_SESSION_COOKIE } from '@/lib/employee-crm-session'
import { getJwtSecret } from '@/lib/jwt-secret'

const secret = getJwtSecret()

export async function GET(req: NextRequest) {
  const crmJwt = req.cookies.get(CRM_SESSION_COOKIE)?.value
  const token = req.cookies.get('token')?.value
  /** Prefer team token on workspace; CRM cookie when team session is absent. */
  const jwt = token ?? crmJwt

  if (!jwt) {
    return NextResponse.json({ user: null }, { status: 401 })
  }

  try {
    const { payload } = await jwtVerify(jwt, secret)
    const p = payload as AppJwtClaims
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
    if (!user) {
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
    return response
  } catch {
    return NextResponse.json({ user: null }, { status: 401 })
  }
}
