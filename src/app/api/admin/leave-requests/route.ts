import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { jwtVerify } from 'jose'
import { db } from '@/lib/db'
import { getJwtSecret } from '@/lib/jwt-secret'

const secret = getJwtSecret()
const ALLOWED_LEAVE_STATUS = new Set(['PENDING', 'APPROVED', 'REJECTED'])

export async function GET(req: NextRequest) {
  const token = req.cookies.get('token')?.value
  if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  try {
    const { payload } = await jwtVerify(token, secret)
    if (payload.role !== 'ADMIN') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

    const { searchParams } = new URL(req.url)
    const statusParam = searchParams.get('status')?.trim().toUpperCase() || ''
    // Audit SEC-9: only query by a known status; ignore unknown values.
    const status = ALLOWED_LEAVE_STATUS.has(statusParam) ? statusParam : null

    const leaveRequests = await db.leaveRequest.findMany({
      where: status ? { status } : undefined,
      include: { user: { select: { name: true, email: true, employeeId: true } } },
      orderBy: { createdAt: 'desc' },
      take: 200,
    })

    return NextResponse.json({ leaveRequests })
  } catch (error) {
    console.error('[admin/leave-requests]', error)
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}
