import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import bcrypt from 'bcryptjs'
import { SignJWT } from 'jose'
import type { NextRequest } from 'next/server'
import { EMPLOYEE_SESSION_COOKIE_MAX_AGE, EMPLOYEE_SESSION_JWT_EXP } from '@/lib/employee-session'
import { getJwtSecret } from '@/lib/jwt-secret'
import { checkRateLimit, getClientIp } from '@/lib/rate-limit'

const secret = getJwtSecret()

const PENDING_COOKIE = 'pending_login'
const OTP_MAX_ATTEMPTS = 5

export async function POST(req: NextRequest) {
  try {
    const sessionId = req.cookies.get(PENDING_COOKIE)?.value
    const ip = getClientIp(req)
    const rl = await checkRateLimit({
      key: `otp:login:ip:${ip}`,
      limit: 20,
      windowMs: 10 * 60 * 1000,
    })
    if (!rl.allowed) {
      return NextResponse.json(
        { error: 'Too many verification attempts. Please wait and retry.' },
        { status: 429, headers: { 'Retry-After': String(rl.retryAfterSec) } }
      )
    }
    if (!sessionId) {
      return NextResponse.json({ error: 'Session expired. Please sign in again.' }, { status: 401 })
    }

    const { otp } = await req.json()
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
      res.cookies.delete(PENDING_COOKIE)
      return res
    }

    if (session.expiresAt < new Date()) {
      await db.loginOtpSession.delete({ where: { id: sessionId } }).catch(() => {})
      const res = NextResponse.json({ error: 'Code expired. Please sign in again.' }, { status: 401 })
      res.cookies.delete(PENDING_COOKIE)
      return res
    }

    const purpose = session.purpose ?? 'LOGIN'
    if (purpose !== 'LOGIN') {
      return NextResponse.json({ error: 'Invalid verification session.' }, { status: 401 })
    }

    const ok = await bcrypt.compare(normalized, session.codeHash)
    if (!ok) {
      // Audit SEC-10: persist attempt count in DB so it survives instance recycling.
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
          { error: 'Too many invalid attempts. Please sign in again.' },
          { status: 429 }
        )
        res.cookies.delete(PENDING_COOKIE)
        return res
      }
      return NextResponse.json({ error: 'Invalid code' }, { status: 401 })
    }

    const user = await db.user.findUnique({ where: { id: session.userId } })
    if (!user) {
      await db.loginOtpSession.delete({ where: { id: sessionId } }).catch(() => {})
      const res = NextResponse.json({ error: 'User not found' }, { status: 401 })
      res.cookies.delete(PENDING_COOKIE)
      return res
    }

    await db.loginOtpSession.delete({ where: { id: sessionId } })

    const claims: Record<string, unknown> = {
      id: user.id,
      email: user.email,
      role: user.role,
    }
    if (user.role === 'EMPLOYEE') claims.crm = false

    const emp = user.role === 'EMPLOYEE'
    const token = await new SignJWT(claims)
      .setProtectedHeader({ alg: 'HS256' })
      .setExpirationTime(emp ? EMPLOYEE_SESSION_JWT_EXP : '24h')
      .sign(secret)

    const redirect =
      user.role === 'ADMIN'
        ? '/admin'
        : user.role === 'ADVISOR'
          ? '/advisor'
          : user.role === 'CASE_ASSESSOR'
            ? '/case-assessor'
            : '/employee'

    const response = NextResponse.json({ success: true, redirect })
    response.cookies.delete(PENDING_COOKIE)
    response.cookies.set('token', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      maxAge: emp ? EMPLOYEE_SESSION_COOKIE_MAX_AGE : 60 * 60 * 24,
    })

    return response
  } catch (error) {
    console.error(error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
