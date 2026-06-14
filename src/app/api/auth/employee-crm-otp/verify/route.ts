import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import bcrypt from 'bcryptjs'
import { db } from '@/lib/db'
import { authenticateEmployeeJwt } from '@/lib/enforce-employee-auth'
import {
  setCrmSessionCookie,
  signCrmSessionJwt,
} from '@/lib/employee-crm-session'
import { checkRateLimit, getClientIp } from '@/lib/rate-limit'
const CRM_PENDING = 'pending_employee_crm'
const OTP_MAX_ATTEMPTS = 5

export async function POST(req: NextRequest) {
  const auth = await authenticateEmployeeJwt(req)
  if (!auth.ok) return auth.response

  try {
    const ip = getClientIp(req)

    const rl = await checkRateLimit({
      key: `otp:employee-verify:ip:${ip}`,
      limit: 20,
      windowMs: 10 * 60 * 1000,
    })
    if (!rl.allowed) {
      return NextResponse.json(
        { error: 'Too many verification attempts. Please wait and retry.' },
        { status: 429, headers: { 'Retry-After': String(rl.retryAfterSec) } }
      )
    }

    const sessionId = req.cookies.get(CRM_PENDING)?.value
    if (!sessionId) {
      return NextResponse.json(
        { error: 'CRM verification session expired. Request a new code.' },
        { status: 401 }
      )
    }

    const { otp } = await req.json().catch(() => ({}))
    if (!otp || typeof otp !== 'string') {
      return NextResponse.json({ error: 'Enter the verification code' }, { status: 400 })
    }
    const normalized = otp.replace(/\s/g, '').slice(0, 8)
    if (!/^\d{6}$/.test(normalized)) {
      return NextResponse.json({ error: 'Code must be 6 digits' }, { status: 400 })
    }

    const session = await db.loginOtpSession.findUnique({
      where: { id: sessionId },
    })

    if (!session) {
      const res = NextResponse.json({ error: 'Invalid or expired session' }, { status: 401 })
      res.cookies.delete(CRM_PENDING)
      return res
    }

    const purpose = session.purpose ?? 'LOGIN'
    if (
      purpose !== 'EMPLOYEE_CRM' ||
      session.userId !== auth.userId
    ) {
      return NextResponse.json({ error: 'Invalid CRM verification session.' }, { status: 401 })
    }

    if (session.expiresAt < new Date()) {
      await db.loginOtpSession.delete({ where: { id: sessionId } }).catch(() => {})
      const res = NextResponse.json({ error: 'Code expired. Request a new one.' }, { status: 401 })
      res.cookies.delete(CRM_PENDING)
      return res
    }

    const ok = await bcrypt.compare(normalized, session.codeHash)
    if (!ok) {
      const updated = await db.loginOtpSession
        .update({
          where: { id: sessionId },
          data: { attempts: { increment: 1 } },
          select: { attempts: true },
        })
        .catch(() => null)
      const failCount = updated?.attempts ?? OTP_MAX_ATTEMPTS
      if (failCount >= OTP_MAX_ATTEMPTS) {
        await db.loginOtpSession.delete({ where: { id: sessionId } }).catch(() => {})
        const res = NextResponse.json(
          { error: 'Too many invalid attempts. Request a new code.' },
          { status: 429 }
        )
        res.cookies.delete(CRM_PENDING)
        return res
      }
      return NextResponse.json({ error: 'Invalid code' }, { status: 401 })
    }

    await db.loginOtpSession.delete({ where: { id: sessionId } })

    const user = await db.user.findUnique({
      where: { id: auth.userId },
      select: { id: true, email: true },
    })
    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 401 })
    }

    const crmJwt = await signCrmSessionJwt({ id: user.id, email: user.email })

    const response = NextResponse.json({ success: true, redirect: '/employee/crm' })
    response.cookies.delete(CRM_PENDING)
    setCrmSessionCookie(response, crmJwt)
    return response
  } catch (error) {
    console.error('[auth/employee-crm-otp/verify]', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
