import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import {
  addressHistoryMeetsFiveYears,
  employeeIntakeFormToRemarks,
  parseEmployeeIntakeForm,
} from '@/lib/employee-intake-form'
import type { Prisma } from '@prisma/client'
import { enforceEmployeeWithCrm } from '@/lib/enforce-employee-auth'
import { LEAD_DISPOSITIONS } from '@/lib/lead-workflow'

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const gated = await enforceEmployeeWithCrm(req)
  if (gated instanceof NextResponse) return gated

  try {
    const { id } = await params
    const lead = await db.lead.findFirst({
      where: { id, assignedToId: gated.userId },
      select: {
        id: true,
        title: true,
        firstName: true,
        lastName: true,
        email: true,
        phone: true,
        disposition: true,
        remarks: true,
        employeeIntakeForm: true,
        moveToAdvisor: true,
        assignedAdvisorId: true,
        callbackAt: true,
        updatedAt: true,
      },
    })
    if (!lead) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    return NextResponse.json({ lead })
  } catch {
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const gated = await enforceEmployeeWithCrm(req)
  if (gated instanceof NextResponse) return gated
  const userId = gated.userId

  try {
    const { id } = await params
    const body = await req.json()

    const existing = await db.lead.findUnique({ where: { id } })
    if (existing?.assignedToId !== userId) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const data: {
      disposition?: string
      remarks?: string | null
      employeeIntakeForm?: Prisma.InputJsonValue
      moveToAdvisor?: boolean
      assignedAdvisorId?: string | null
      callbackAt?: Date | null
      updatedAt?: Date
    } = {}

    if (body.disposition !== undefined) {
      if (!LEAD_DISPOSITIONS.includes(body.disposition)) {
        return NextResponse.json({ error: 'Invalid disposition' }, { status: 400 })
      }
      data.disposition = body.disposition
    }
    if (body.remarks !== undefined) data.remarks = body.remarks

    if (body.employeeIntakeForm !== undefined) {
      const parsed = parseEmployeeIntakeForm(body.employeeIntakeForm)
      if (!addressHistoryMeetsFiveYears(parsed)) {
        return NextResponse.json(
          { error: 'Address history should cover at least 5 years (60 months).' },
          { status: 400 }
        )
      }
      data.employeeIntakeForm = parsed as unknown as Prisma.InputJsonValue
      data.remarks = employeeIntakeFormToRemarks(parsed)
    }

    if (body.callbackAt !== undefined) {
      data.callbackAt = body.callbackAt ? new Date(body.callbackAt) : null
    }

    if (body.assignedAdvisorId !== undefined) {
      const aid = body.assignedAdvisorId
      if (aid === null || aid === '') {
        data.assignedAdvisorId = null
        data.moveToAdvisor = false
      } else {
        const advisor = await db.user.findFirst({
          where: { id: aid, role: 'ADVISOR' },
        })
        if (!advisor) {
          return NextResponse.json({ error: 'Invalid advisor' }, { status: 400 })
        }
        data.assignedAdvisorId = aid
        data.moveToAdvisor = true
      }
    } else if (body.moveToAdvisor !== undefined) {
      data.moveToAdvisor = body.moveToAdvisor
      if (body.moveToAdvisor === false) {
        data.assignedAdvisorId = null
      }
    }

    if (
      data.disposition !== undefined ||
      data.callbackAt !== undefined ||
      data.assignedAdvisorId !== undefined ||
      data.moveToAdvisor !== undefined ||
      data.employeeIntakeForm !== undefined
    ) {
      data.updatedAt = new Date()
    }

    const updated = await db.lead.update({
      where: { id },
      data,
      select: {
        id: true,
        disposition: true,
        remarks: true,
        employeeIntakeForm: true,
        moveToAdvisor: true,
        assignedAdvisorId: true,
        callbackAt: true,
        updatedAt: true,
      },
    })

    return NextResponse.json({ success: true, lead: updated })
  } catch (error) {
    console.error(error)
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}
