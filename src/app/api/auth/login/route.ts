import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import bcrypt from 'bcryptjs'
import { SignJWT } from 'jose'
import { randomInt } from 'crypto'
import { sendLoginOtpToAdmin } from '@/lib/mail'
import { EMPLOYEE_SESSION_COOKIE_MAX_AGE, EMPLOYEE_SESSION_JWT_EXP } from '@/lib/employee-session'
import { getJwtSecret } from '@/lib/jwt-secret'
import { checkRateLimit, getClientIp } from '@/lib/rate-limit'
import { isOtpBypassAllowed } from '@/lib/otp-config'

const secret = getJwtSecret()
const PENDING_COOKIE = 'pending_login'

function buildAuthResponse(user: { id: string; email: string; role: string }) {
  const redirect =
    user.role === 'ADMIN'
      ? '/admin'
      : user.role === 'ADVISOR'
        ? '/advisor'
        : user.role === 'CASE_ASSESSOR'
          ? '/case-assessor'
          : '/employee'

  return { redirect }
}

export async function POST(req: NextRequest) {
  try {
    const { email, password } = await req.json()
    const normalizedEmail = typeof email === 'string' ? email.trim().toLowerCase() : ''
    const ip = getClientIp(req)

    const ipLimit = await checkRateLimit({
      key: `login:ip:${ip}`,
      limit: 25,
      windowMs: 10 * 60 * 1000,
    })
    if (!ipLimit.allowed) {
      return NextResponse.json(
        { error: 'Too many login attempts. Please try again shortly.' },
        { status: 429, headers: { 'Retry-After': String(ipLimit.retryAfterSec) } }
      )
    }

    if (!normalizedEmail || !password) {
      return NextResponse.json({ error: 'Missing email or password' }, { status: 400 })
    }

    const userLimit = await checkRateLimit({
      key: `login:user:${normalizedEmail}`,
      limit: 8,
      windowMs: 10 * 60 * 1000,
    })
    if (!userLimit.allowed) {
      return NextResponse.json(
        { error: 'Too many login attempts for this account. Please try again shortly.' },
        { status: 429, headers: { 'Retry-After': String(userLimit.retryAfterSec) } }
      )
    }

    const user = await db.user.findUnique({
      where: { email: normalizedEmail },
    })

    if (!user) {
      return NextResponse.json({ error: 'Invalid email or password' }, { status: 401 })
    }

    const isValid = await bcrypt.compare(password, user.password)
    if (!isValid) {
      return NextResponse.json({ error: 'Invalid email or password' }, { status: 401 })
    }

    const adminEmail = process.env.ADMIN_EMAIL?.trim()
    const otpEnabled = !!adminEmail

    if (!otpEnabled) {
      // Audit SEC-1: never silently disable OTP in production.
      if (!isOtpBypassAllowed()) {
        console.error(
          '[auth/login] ADMIN_EMAIL is not configured in production. Set ADMIN_EMAIL (and SMTP) or DISABLE_LOGIN_OTP=true to intentionally bypass.'
        )
        return NextResponse.json(
          { error: 'Login is not fully configured on the server. Please contact your administrator.' },
          { status: 503 }
        )
      }
      const claims: Record<string, unknown> = {
        id: user.id,
        email: user.email,
        role: user.role,
      }
      const isEmp = user.role === 'EMPLOYEE'
      if (isEmp) claims.crm = true

      const token = await new SignJWT(claims)
        .setProtectedHeader({ alg: 'HS256' })
        .setExpirationTime(isEmp ? EMPLOYEE_SESSION_JWT_EXP : '24h')
        .sign(secret)

      const { redirect } = buildAuthResponse(user)
      const response = NextResponse.json({ success: true, redirect, requireOtp: false })
      response.cookies.set('token', token, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        path: '/',
        maxAge: isEmp ? EMPLOYEE_SESSION_COOKIE_MAX_AGE : 60 * 60 * 24,
      })
      return response
    }

    if (user.role === 'EMPLOYEE') {
      const token = await new SignJWT({
        id: user.id,
        email: user.email,
        role: user.role,
        crm: false,
      })
        .setProtectedHeader({ alg: 'HS256' })
        .setExpirationTime(EMPLOYEE_SESSION_JWT_EXP)
        .sign(secret)

      const response = NextResponse.json({
        success: true,
        redirect: '/employee',
        requireOtp: false,
        employeeHubOnly: true,
      })
      response.cookies.set('token', token, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        path: '/',
        maxAge: EMPLOYEE_SESSION_COOKIE_MAX_AGE,
      })
      return response
    }

    const loginOtpSession = Reflect.get(db, 'loginOtpSession') as
      | (typeof db)['loginOtpSession']
      | undefined
    if (!loginOtpSession) {
      console.error(
        'Prisma client is missing `loginOtpSession`. Run `npx prisma generate` and restart the dev server (or run `npm run dev` so `predev` runs).'
      )
      return NextResponse.json(
        {
          error:
            'Server configuration error. Run `npx prisma generate`, then stop and start your dev server again.',
        },
        { status: 503 }
      )
    }

    const code = String(randomInt(100000, 1000000))
    const codeHash = await bcrypt.hash(code, 10)
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000)

    const session = await loginOtpSession.create({
      data: {
        userId: user.id,
        codeHash,
        expiresAt,
        purpose: 'LOGIN',
      },
    })

    try {
      await sendLoginOtpToAdmin({
        otp: code,
        loginEmail: user.email,
        userName: user.name,
      })
    } catch (e) {
      console.error(e)
      await loginOtpSession.delete({ where: { id: session.id } }).catch(() => {})
      return NextResponse.json(
        {
          error:
            'Could not send login code. Set ADMIN_EMAIL and SMTP settings in the server environment, or use development mode to print the code in the server log.',
        },
        { status: 503 }
      )
    }

    const response = NextResponse.json({
      success: true,
      requireOtp: true,
      message: 'A verification code was sent to the administrator email address.',
    })
    response.cookies.set(PENDING_COOKIE, session.id, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      maxAge: 60 * 10,
    })
    return response
  } catch (error) {
    console.error(error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
