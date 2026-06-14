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

    const advisors = await db.user.findMany({
      where: { role: 'ADVISOR' },
      select: { id: true, employeeId: true, name: true, email: true, createdAt: true },
      orderBy: { createdAt: 'desc' }
    })

    return NextResponse.json({ advisors })
  } catch (error) {
    console.error('[admin/advisors GET]', error)
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  const token = req.cookies.get('token')?.value
  if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  try {
    const { payload } = await jwtVerify(token, secret)
    if (payload.role !== 'ADMIN') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

    const body = await req.json()
    const { name, email, password } = body

    if (!name || !email || !password) {
      return NextResponse.json({ error: 'Missing fields' }, { status: 400 })
    }

    const existingUser = await db.user.findUnique({ where: { email } })
    if (existingUser) {
      return NextResponse.json({ error: 'Email already in use' }, { status: 400 })
    }

    const hashedPassword = await bcrypt.hash(password, 10)
    const newEmployeeId = `ADV-${Math.random().toString(36).substring(2, 8).toUpperCase()}`

    const adv = await db.user.create({
      data: {
        name,
        email,
        password: hashedPassword,
        employeeId: newEmployeeId,
        role: 'ADVISOR'
      }
    })

    return NextResponse.json({ success: true, advisor: { id: adv.id, employeeId: adv.employeeId, name: adv.name, email: adv.email } })
  } catch (error) {
    console.error(error)
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}

export async function PUT(req: NextRequest) {
  const token = req.cookies.get('token')?.value
  if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  try {
    const { payload } = await jwtVerify(token, secret)
    if (payload.role !== 'ADMIN') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

    const { employeeIdToPromote } = await req.json()
    if (!employeeIdToPromote) return NextResponse.json({ error: 'Missing id' }, { status: 400 })

    const user = await db.user.findUnique({ where: { id: employeeIdToPromote } })
    if (!user || user.role !== 'EMPLOYEE') {
      return NextResponse.json({ error: 'Invalid employee' }, { status: 400 })
    }

    await db.user.update({
      where: { id: employeeIdToPromote },
      data: { role: 'ADVISOR', employeeId: user.employeeId?.replace('EMP-', 'ADV-') }
    })

    return NextResponse.json({ success: true })
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

    await db.lead.updateMany({
      where: { assignedAdvisorId: id },
      data: { assignedAdvisorId: null }
    })

    await db.user.delete({
      where: { id }
    })

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error(error)
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}
