import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { jwtVerify } from 'jose'
import { db } from '@/lib/db'
import bcrypt from 'bcryptjs'

const secret = new TextEncoder().encode(process.env.JWT_SECRET)

export async function GET(req: NextRequest) {
  const token = req.cookies.get('token')?.value
  if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  try {
    const { payload } = await jwtVerify(token, secret)
    if (payload.role !== 'ADMIN') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

    const assessors = await db.user.findMany({
      where: { role: 'CASE_ASSESSOR' },
      select: { id: true, employeeId: true, name: true, email: true, createdAt: true },
      orderBy: { createdAt: 'desc' },
    })

    return NextResponse.json({ assessors })
  } catch (error) {
    console.error('[admin/case-assessors GET]', error)
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  const token = req.cookies.get('token')?.value
  if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  try {
    const { payload } = await jwtVerify(token, secret)
    if (payload.role !== 'ADMIN') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

    const { name, email, password } = await req.json()

    if (!name || !email || !password) {
      return NextResponse.json({ error: 'Missing fields' }, { status: 400 })
    }

    const existingUser = await db.user.findUnique({ where: { email } })
    if (existingUser) {
      return NextResponse.json({ error: 'Email already in use' }, { status: 400 })
    }

    const hashedPassword = await bcrypt.hash(password, 10)
    const newId = `CAS-${Math.random().toString(36).substring(2, 8).toUpperCase()}`

    const assessor = await db.user.create({
      data: {
        name,
        email,
        password: hashedPassword,
        employeeId: newId,
        role: 'CASE_ASSESSOR',
      },
    })

    return NextResponse.json({
      success: true,
      assessor: { id: assessor.id, employeeId: assessor.employeeId, name: assessor.name, email: assessor.email },
    })
  } catch (error) {
    console.error(error)
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}

export async function DELETE(req: NextRequest) {
  const token = req.cookies.get('token')?.value
  if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  try {
    const { payload } = await jwtVerify(token, secret)
    if (payload.role !== 'ADMIN') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

    const { id } = await req.json()
    if (!id) return NextResponse.json({ error: 'Missing ID' }, { status: 400 })

    const assessor = await db.user.findFirst({ where: { id, role: 'CASE_ASSESSOR' } })
    if (!assessor) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    await db.lead.updateMany({
      where: { assignedCaseAssessorId: id },
      data: { assignedCaseAssessorId: null },
    })

    await db.user.delete({ where: { id } })

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error(error)
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}
