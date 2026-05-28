import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { jwtVerify } from 'jose'
import { db } from '@/lib/db'
import type { Prisma } from '@prisma/client'
import { CASE_STATUSES, parseCaseChecklist } from '@/lib/lead-workflow'
import { parseEmployeeIntakeForm, addressHistoryMeetsFiveYears } from '@/lib/employee-intake-form'
import { getJwtSecret } from '@/lib/jwt-secret'

const secret = getJwtSecret()

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const token = req.cookies.get('token')?.value
  if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  try {
    const { payload } = await jwtVerify(token, secret)
    const userId = payload.id as string
    if (payload.role !== 'CASE_ASSESSOR') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const { id } = await params
    const lead = await db.lead.findFirst({
      where: { id, assignedCaseAssessorId: userId },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        email: true,
        phone: true,
        caseStatus: true,
        caseChecklist: true,
        preSipAt: true,
        remarks: true,
        employeeIntakeForm: true,
        updatedAt: true,
        assignedTo: { select: { name: true } },
        assignedAdvisor: { select: { name: true } },
      },
    })
    if (!lead) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    return NextResponse.json({ lead })
  } catch {
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const token = req.cookies.get('token')?.value
  if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  try {
    const { payload } = await jwtVerify(token, secret)
    const userId = payload.id as string

    if (payload.role !== 'CASE_ASSESSOR') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const { id } = await params
    const body = await req.json()

    const existing = await db.lead.findFirst({
      where: { id, assignedCaseAssessorId: userId },
      select: {
        id: true,
        verifiedSale: true,
        verifiedAt: true,
        caseStatus: true,
        employeeIntakeForm: true,
      },
    })
    if (!existing) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const data: {
      caseStatus?: string
      caseChecklist?: Prisma.InputJsonValue
      preSipAt?: Date | null
      employeeIntakeForm?: Prisma.InputJsonValue
      verifiedSale?: boolean
      verifiedAt?: Date | null
      updatedAt?: Date
    } = {}

    if (body.caseStatus !== undefined) {
      if (!CASE_STATUSES.includes(body.caseStatus)) {
        return NextResponse.json({ error: 'Invalid case status' }, { status: 400 })
      }
      data.caseStatus = body.caseStatus
      data.verifiedSale = body.caseStatus === 'VERIFIED'
      if (body.caseStatus === 'VERIFIED') {
        if (!existing.verifiedAt) data.verifiedAt = new Date()
      } else {
        data.verifiedAt = null
      }
    }

    if (body.caseChecklist !== undefined) {
      data.caseChecklist = parseCaseChecklist(body.caseChecklist) as unknown as Prisma.InputJsonValue
    }

    if (body.preSipAt !== undefined) {
      data.preSipAt = body.preSipAt ? new Date(body.preSipAt) : null
    }

    if (body.employeeIntakeForm !== undefined) {
      const parsed = parseEmployeeIntakeForm(body.employeeIntakeForm)
      if (!addressHistoryMeetsFiveYears(parsed)) {
        return NextResponse.json(
          { error: 'Address history should cover at least 5 years (60 months).' },
          { status: 400 }
        )
      }
      data.employeeIntakeForm = parsed as unknown as Prisma.InputJsonValue
    }

    if (Object.keys(data).length === 0) {
      return NextResponse.json({ success: true, lead: existing })
    }

    data.updatedAt = new Date()

    const updated = await db.lead.update({
      where: { id },
      data,
      select: {
        id: true,
        caseStatus: true,
        caseChecklist: true,
        preSipAt: true,
        employeeIntakeForm: true,
        updatedAt: true,
      },
    })

    return NextResponse.json({ success: true, lead: updated })
  } catch (error) {
    console.error(error)
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}
