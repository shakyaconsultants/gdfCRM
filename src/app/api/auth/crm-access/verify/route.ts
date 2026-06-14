import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import bcrypt from 'bcryptjs'
import { db } from '@/lib/db'
import { checkRateLimit, getClientIp } from '@/lib/rate-limit'
import {
  setCrmSessionCookie,
  signCrmSessionJwt,
} from '@/lib/employee-crm-session'
const CRM_DIRECT_PENDING = 'pending_crm_direct'
const OTP_MAX_ATTEMPTS = 5

export async function POST(req: NextRequest) {
  try {
    const ip = getClientIp(req)

    const rl = await checkRateLimit({
      key: `otp:crm-direct-verify:ip:${ip}`,
      limit: 20,
      windowMs: 10 * 60 * 1000,
    })
    if (!rl.allowed) {
      return NextResponse.json(
        { error: 'Too many attempts. Please wait and try again.' },
        { status: 429, headers: { 'Retry-After': String(rl.retryAfterSec) } }
      )
    }

    const sessionId = req.cookies.get(CRM_DIRECT_PENDING)?.value
    if (!sessionId) {
      return NextResponse.json(
        { error: 'Session expired. Please request a new code.' },
        { status: 401 }
      )
    }

    const body = await req.json().catch(() => ({}))
    const otp = typeof body.otp === 'string' ? body.otp.replace(/\D/g, '').slice(0, 8) : ''
    if (!/^\d{6}$/.test(otp)) {
      return NextResponse.json({ error: 'Code must be 6 digits.' }, { status: 400 })
    }

    const session = await db.loginOtpSession.findUnique({ where: { id: sessionId } })
    if (!session || (session.purpose ?? 'LOGIN') !== 'CRM_DIRECT') {
      const res = NextResponse.json({ error: 'Invalid or expired session.' }, { status: 401 })
      res.cookies.delete(CRM_DIRECT_PENDING)
      return res
    }

    if (session.expiresAt < new Date()) {
      await db.loginOtpSession.delete({ where: { id: sessionId } }).catch(() => {})
      const res = NextResponse.json({ error: 'Code expired. Request a new one.' }, { status: 401 })
      res.cookies.delete(CRM_DIRECT_PENDING)
      return res
    }

    const ok = await bcrypt.compare(otp, session.codeHash)
    if (!ok) {
      const updated = await db.loginOtpSession
        .update({
          where: { id: sessionId },
          data: { attempts: { increment: 1 } },
          select: { attempts: true },
        })
        .catch(() => null)
      const count = updated?.attempts ?? OTP_MAX_ATTEMPTS
      if (count >= OTP_MAX_ATTEMPTS) {
        await db.loginOtpSession.delete({ where: { id: sessionId } }).catch(() => {})
        const res = NextResponse.json(
          { error: 'Too many invalid attempts. Request a new code.' },
          { status: 429 }
        )
        res.cookies.delete(CRM_DIRECT_PENDING)
        return res
      }
      return NextResponse.json({ error: 'Invalid code.' }, { status: 401 })
    }

    await db.loginOtpSession.delete({ where: { id: sessionId } })

    const user = await db.user.findUnique({ where: { id: session.userId } })
    if (!user || user.role !== 'EMPLOYEE') {
      return NextResponse.json({ error: 'Account not found.' }, { status: 401 })
    }

    const crmJwt = await signCrmSessionJwt({ id: user.id, email: user.email })

    const response = NextResponse.json({ success: true, redirect: '/employee/crm' })
    response.cookies.delete(CRM_DIRECT_PENDING)
    setCrmSessionCookie(response, crmJwt)
    return response
  } catch (error) {
    console.error('[auth/crm-access/verify]', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
