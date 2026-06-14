import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { jwtVerify } from 'jose'
import { db } from '@/lib/db'

const secret = new TextEncoder().encode(process.env.JWT_SECRET)

export async function GET(req: NextRequest) {
  const token = req.cookies.get('token')?.value
  if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  try {
    const { payload } = await jwtVerify(token, secret)
    if (payload.role !== 'ADVISOR') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const assessors = await db.user.findMany({
      where: { role: 'CASE_ASSESSOR' },
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
    })

    return NextResponse.json({ assessors })
  } catch (error) {
    console.error('[advisor/case-assessors GET]', error)
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}
