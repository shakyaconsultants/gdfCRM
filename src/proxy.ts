import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { jwtVerify } from 'jose'
import { employeeHasCrmAccess, type AppJwtClaims } from '@/lib/employee-jwt'
import {
  CRM_SESSION_COOKIE,
  isCrmSessionPayload,
} from '@/lib/employee-crm-session'
import { getJwtSecret } from '@/lib/jwt-secret'

const secret = getJwtSecret()

async function verifyCookieJwt(
  value: string | undefined
): Promise<AppJwtClaims | null> {
  if (!value) return null
  try {
    const { payload } = await jwtVerify(value, secret)
    return payload as AppJwtClaims
  } catch {
    return null
  }
}

function hubRedirectForRole(role: string) {
  if (role === 'ADMIN') return '/admin'
  if (role === 'ADVISOR') return '/advisor'
  if (role === 'CASE_ASSESSOR') return '/case-assessor'
  return '/employee'
}

export async function proxy(request: NextRequest) {
  const pathname = request.nextUrl.pathname
  const token = request.cookies.get('token')?.value
  const crmSession = request.cookies.get(CRM_SESSION_COOKIE)?.value

  const adminOtpConfigured = !!(process.env.ADMIN_EMAIL ?? '').trim()
  const isLoginPage = pathname.startsWith('/login')
  const isMarketingHome = pathname === '/'
  const isCrmAccessPage = pathname.startsWith('/crm-access')
  const isCrmPath =
    pathname === '/employee/crm' || pathname.startsWith('/employee/crm/')
  const isEmployeeHubPath =
    (pathname === '/employee' || pathname.startsWith('/employee/')) && !isCrmPath

  // Only verify cookies needed for this path (avoids 2x jwtVerify on every navigation)
  let crmPayload: AppJwtClaims | null = null
  let hubPayload: AppJwtClaims | null = null

  if (isCrmPath) {
    crmPayload = await verifyCookieJwt(crmSession)
    const hasCrmSession = crmPayload !== null && isCrmSessionPayload(crmPayload)
    if (hasCrmSession) return NextResponse.next()
    hubPayload = await verifyCookieJwt(token)
    if (
      hubPayload?.role === 'EMPLOYEE' &&
      (!adminOtpConfigured || employeeHasCrmAccess(hubPayload))
    ) {
      return NextResponse.next()
    }
    return NextResponse.redirect(new URL('/crm-access', request.url))
  }

  if (isLoginPage) {
    hubPayload = await verifyCookieJwt(token)
    if (hubPayload?.role) {
      return NextResponse.redirect(
        new URL(hubRedirectForRole(hubPayload.role as string), request.url)
      )
    }
    return NextResponse.next()
  }

  if (isMarketingHome || isCrmAccessPage) {
    return NextResponse.next()
  }

  if (!token && !crmSession) {
    return NextResponse.redirect(new URL('/login', request.url))
  }

  if (isEmployeeHubPath) {
    hubPayload = hubPayload ?? (await verifyCookieJwt(token))
    if (!hubPayload || hubPayload.role !== 'EMPLOYEE') {
      return NextResponse.redirect(new URL('/login', request.url))
    }
    return NextResponse.next()
  }

  hubPayload = hubPayload ?? (await verifyCookieJwt(token))

  if (!hubPayload) {
    crmPayload = crmPayload ?? (await verifyCookieJwt(crmSession))
    const hasCrmSession = crmPayload !== null && isCrmSessionPayload(crmPayload)
    if (hasCrmSession) {
      return NextResponse.redirect(new URL('/employee/crm', request.url))
    }
    const response = NextResponse.redirect(new URL('/login', request.url))
    response.cookies.delete('token')
    response.cookies.delete(CRM_SESSION_COOKIE)
    return response
  }

  const role = hubPayload.role as string

  if (pathname.startsWith('/admin') && role !== 'ADMIN') {
    return NextResponse.redirect(new URL('/employee', request.url))
  }

  return NextResponse.next()
}

export const config = {
  matcher: ['/((?!api|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)'],
}
