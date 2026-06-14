import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { jwtVerify } from 'jose'
import { randomBytes } from 'crypto'
import { db } from '@/lib/db'
import bcrypt from 'bcryptjs'
import { getJwtSecret } from '@/lib/jwt-secret'
import { BCRYPT_COST, sanitizeImageUrl, validatePasswordInput } from '@/lib/password-policy'

const secret = getJwtSecret()

export async function GET(req: NextRequest) {
  const token = req.cookies.get('token')?.value
  if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  try {
    const { payload } = await jwtVerify(token, secret)
    if (payload.role !== 'ADMIN') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

    const employees = await db.user.findMany({
      where: { role: 'EMPLOYEE' },
      select: {
        id: true,
        employeeId: true,
        name: true,
        email: true,
        profileImageUrl: true,
        baseSalaryMonthly: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'desc' }
    })

    return NextResponse.json({ employees })
  } catch (error) {
    console.error('[admin/employees GET]', error)
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  const token = req.cookies.get('token')?.value
  if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  try {
    const { payload } = await jwtVerify(token, secret)
    if (payload.role !== 'ADMIN') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

    const { name, email, password, baseSalaryMonthly, profileImageUrl } = await req.json()

    if (!name || !email || !password) {
      return NextResponse.json({ error: 'Missing fields' }, { status: 400 })
    }

    const normalizedEmail = String(email).trim().toLowerCase()
    const normalizedName = String(name).trim()
    if (!normalizedName || !normalizedEmail) {
      return NextResponse.json({ error: 'Missing fields' }, { status: 400 })
    }

    const pwError = validatePasswordInput(password)
    if (pwError) {
      return NextResponse.json({ error: pwError }, { status: 400 })
    }

    let parsedBaseSalary: number | null = null
    if (baseSalaryMonthly !== undefined && baseSalaryMonthly !== null && baseSalaryMonthly !== '') {
      const n = Number(baseSalaryMonthly)
      if (!Number.isFinite(n) || n < 0) {
        return NextResponse.json({ error: 'Invalid in-hand salary' }, { status: 400 })
      }
      parsedBaseSalary = n
    }

    const existingUser = await db.user.findUnique({ where: { email: normalizedEmail } })
    if (existingUser) {
      return NextResponse.json({ error: 'Email already in use' }, { status: 400 })
    }

    const hashedPassword = await bcrypt.hash(password, BCRYPT_COST)
    const newEmployeeId = `EMP-${randomBytes(4).toString('hex').toUpperCase()}`

    const emp = await db.user.create({
      data: {
        name: normalizedName,
        email: normalizedEmail,
        password: hashedPassword,
        employeeId: newEmployeeId,
        baseSalaryMonthly: parsedBaseSalary,
        profileImageUrl: sanitizeImageUrl(profileImageUrl),
        role: 'EMPLOYEE'
      }
    })

    return NextResponse.json({
      success: true,
      employee: {
        id: emp.id,
        employeeId: emp.employeeId,
        name: emp.name,
        email: emp.email,
        baseSalaryMonthly: emp.baseSalaryMonthly,
        profileImageUrl: emp.profileImageUrl,
      },
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
    if (!id) return NextResponse.json({ error: 'Missing employee ID' }, { status: 400 })

    // Audit SEC-4: only EMPLOYEE accounts may be deleted here — never an admin/advisor/assessor.
    const target = await db.user.findFirst({ where: { id, role: 'EMPLOYEE' }, select: { id: true } })
    if (!target) {
      return NextResponse.json({ error: 'Employee not found' }, { status: 404 })
    }

    // Clean all lead FK relations (employee/advisor/assessor) in one transaction to avoid orphans.
    await db.$transaction([
      db.lead.updateMany({ where: { assignedToId: id }, data: { assignedToId: null } }),
      db.lead.updateMany({ where: { assignedAdvisorId: id }, data: { assignedAdvisorId: null } }),
      db.lead.updateMany({
        where: { assignedCaseAssessorId: id },
        data: { assignedCaseAssessorId: null },
      }),
      db.user.delete({ where: { id } }),
    ])

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error(error)
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}
