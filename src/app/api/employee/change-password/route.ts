import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import bcrypt from 'bcryptjs'
import { db } from '@/lib/db'
import { authenticateEmployeeJwt } from '@/lib/enforce-employee-auth'
import { checkRateLimit, getClientIp } from '@/lib/rate-limit'
import { BCRYPT_COST, validatePasswordInput } from '@/lib/password-policy'

export async function POST(req: NextRequest) {
  const auth = await authenticateEmployeeJwt(req)
  if (!auth.ok) return auth.response

  try {
    const ip = getClientIp(req)
    const rl = await checkRateLimit({
      key: `change-password:${auth.userId}:${ip}`,
      limit: 5,
      windowMs: 15 * 60 * 1000,
    })
    if (!rl.allowed) {
      return NextResponse.json(
        { error: 'Too many attempts. Try again later.' },
        { status: 429 }
      )
    }

    const body = await req.json().catch(() => ({}))
    const { currentPassword, newPassword } = body

    if (!currentPassword || !newPassword) {
      return NextResponse.json({ error: 'Both current and new password are required.' }, { status: 400 })
    }
    if (typeof currentPassword !== 'string' || currentPassword.length > 128) {
      return NextResponse.json({ error: 'Invalid current password.' }, { status: 400 })
    }
    const pwError = validatePasswordInput(newPassword)
    if (pwError) {
      return NextResponse.json({ error: pwError }, { status: 400 })
    }

    const user = await db.user.findUnique({ where: { id: auth.userId } })
    if (!user) {
      return NextResponse.json({ error: 'User not found.' }, { status: 404 })
    }

    const valid = await bcrypt.compare(currentPassword, user.password)
    if (!valid) {
      return NextResponse.json({ error: 'Current password is incorrect.' }, { status: 401 })
    }

    const hashed = await bcrypt.hash(newPassword, BCRYPT_COST)
    await db.user.update({ where: { id: auth.userId }, data: { password: hashed } })

    return NextResponse.json({ success: true, message: 'Password updated successfully.' })
  } catch (error) {
    console.error('[employee/change-password]', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
