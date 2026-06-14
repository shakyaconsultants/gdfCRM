import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import bcrypt from 'bcryptjs'
import { randomInt } from 'crypto'
import { db } from '@/lib/db'
import { authenticateEmployeeJwt } from '@/lib/enforce-employee-auth'
import { employeeHasCrmAccess } from '@/lib/employee-jwt'
import { isGlobalOtpEnabled, isOtpBypassAllowed } from '@/lib/otp-config'
import { sendEmployeeCrmUnlockOtp } from '@/lib/crm-mail'
import {
  setCrmSessionCookie,
  signCrmSessionJwt,
} from '@/lib/employee-crm-session'
import { checkRateLimit, getClientIp } from '@/lib/rate-limit'
const CRM_PENDING = 'pending_employee_crm'

export async function POST(req: NextRequest) {
  const auth = await authenticateEmployeeJwt(req)
  if (!auth.ok) return auth.response

  try {
  const ip = getClientIp(req)

  const ipLimit = await checkRateLimit({
    key: `otp:employee-send:ip:${ip}`,
    limit: 12,
    windowMs: 10 * 60 * 1000,
  })
  if (!ipLimit.allowed) {
    return NextResponse.json(
      { error: 'Too many OTP requests. Please wait and retry.' },
      { status: 429, headers: { 'Retry-After': String(ipLimit.retryAfterSec) } }
    )
  }

  const userLimit = await checkRateLimit({
    key: `otp:employee-send:user:${auth.userId}`,
    limit: 6,
    windowMs: 10 * 60 * 1000,
  })
  if (!userLimit.allowed) {
    return NextResponse.json(
      { error: 'Too many OTP requests for this user. Please wait and retry.' },
      { status: 429, headers: { 'Retry-After': String(userLimit.retryAfterSec) } }
    )
  }

  if (!isGlobalOtpEnabled()) {
    // Audit SEC-2: never hand out a CRM session without OTP in production.
    if (!isOtpBypassAllowed()) {
      console.error(
        '[employee-crm-otp/send] ADMIN_EMAIL not configured in production; CRM second factor cannot be issued.'
      )
      return NextResponse.json(
        { error: 'CRM verification is not configured on the server. Please contact your administrator.' },
        { status: 503 }
      )
    }
    const user = await db.user.findUnique({
      where: { id: auth.userId },
      select: { id: true, email: true },
    })
    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 401 })
    }
    const crmJwt = await signCrmSessionJwt({ id: user.id, email: user.email })
    const response = NextResponse.json({
      success: true,
      unlocked: true,
      message: 'CRM already available (OTP disabled).',
    })
    setCrmSessionCookie(response, crmJwt)
    return response
  }

  if (employeeHasCrmAccess(auth.payload)) {
    return NextResponse.json({ error: 'CRM is already unlocked for this session.' }, { status: 400 })
  }

  const loginOtpSession = Reflect.get(db, 'loginOtpSession') as
    | (typeof db)['loginOtpSession']
    | undefined
  if (!loginOtpSession) {
    return NextResponse.json({ error: 'OTP model unavailable.' }, { status: 503 })
  }

  const user = await db.user.findUnique({ where: { id: auth.userId } })
  if (!user || user.role !== 'EMPLOYEE') {
    return NextResponse.json({ error: 'User not found' }, { status: 401 })
  }

  await loginOtpSession.deleteMany({
    where: { userId: auth.userId, purpose: 'EMPLOYEE_CRM' },
  })

  const code = String(randomInt(100000, 1000000))
  const codeHash = await bcrypt.hash(code, 10)
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000)

  const session = await loginOtpSession.create({
    data: {
      userId: auth.userId,
      codeHash,
      expiresAt,
      purpose: 'EMPLOYEE_CRM',
    },
  })

  try {
    await sendEmployeeCrmUnlockOtp({
      employeeName: user.name,
      otp: code,
    })
  } catch (e) {
    console.error(e)
    await loginOtpSession.delete({ where: { id: session.id } }).catch(() => {})
    return NextResponse.json(
      { error: 'Could not send CRM code. Configure SMTP_* in your environment.' },
      { status: 503 }
    )
  }

  const response = NextResponse.json({
    success: true,
    message: 'A verification code was sent to the designated admin inboxes.',
  })
  response.cookies.set(CRM_PENDING, session.id, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: 60 * 10,
  })
  return response
  } catch (error) {
    console.error('[auth/employee-crm-otp/send]', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
