import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { jwtVerify } from 'jose'
import type { Prisma } from '@prisma/client'
import { db } from '@/lib/db'
import {
  addressHistoryMeetsFiveYears,
  employeeIntakeFormToRemarks,
  parseEmployeeIntakeForm,
} from '@/lib/employee-intake-form'
import { invalidateAdminDashboardCache } from '@/lib/admin-dashboard-cache'
import { LEAD_DISPOSITIONS } from '@/lib/lead-workflow'
import { getJwtSecret } from '@/lib/jwt-secret'

const secret = getJwtSecret()

const ADMIN_LEAD_DETAIL_SELECT = {
  id: true,
  title: true,
  firstName: true,
  lastName: true,
  email: true,
  phone: true,
  disposition: true,
  callbackAt: true,
  remarks: true,
  address: true,
  addressLine1: true,
  addressLine2: true,
  addressLine3: true,
  addressLine4: true,
  postCode: true,
  verifiedSale: true,
  paymentReceived: true,
  closedSale: true,
  employeeIntakeForm: true,
  assignedTo: { select: { name: true } },
} as const

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const token = req.cookies.get('token')?.value
  if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  try {
    const { payload } = await jwtVerify(token, secret)
    if (payload.role !== 'ADMIN') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

    const { id } = await params
    const lead = await db.lead.findUnique({
      where: { id },
      select: ADMIN_LEAD_DETAIL_SELECT,
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
    if (payload.role !== 'ADMIN') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

    const { id } = await params
    const body = await req.json()

    const existing = await db.lead.findUnique({
      where: { id },
      select: { verifiedSale: true, verifiedAt: true },
    })
    if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    const updateData: Prisma.LeadUpdateInput = {}
    let metricsChanged = false

    if (body.title !== undefined) updateData.title = body.title ? String(body.title) : null
    if (body.firstName !== undefined) updateData.firstName = String(body.firstName ?? '')
    if (body.lastName !== undefined) updateData.lastName = body.lastName ? String(body.lastName) : null
    if (body.email !== undefined) {
      updateData.email = body.email ? String(body.email).trim().toLowerCase() : null
    }

    if (body.disposition !== undefined) {
      if (!LEAD_DISPOSITIONS.includes(body.disposition)) {
        return NextResponse.json({ error: 'Invalid disposition' }, { status: 400 })
      }
      updateData.disposition = body.disposition
      metricsChanged = true
      if (body.disposition !== 'Callback') {
        updateData.callbackAt = null
      }
    }

    if (body.callbackAt !== undefined) {
      updateData.callbackAt = body.callbackAt ? new Date(body.callbackAt) : null
    }

    if (body.remarks !== undefined) updateData.remarks = body.remarks

    if (body.employeeIntakeForm !== undefined) {
      const parsed = parseEmployeeIntakeForm(body.employeeIntakeForm)
      if (!addressHistoryMeetsFiveYears(parsed)) {
        return NextResponse.json(
          { error: 'Address history should cover at least 5 years (60 months).' },
          { status: 400 }
        )
      }
      updateData.employeeIntakeForm = parsed as unknown as Prisma.InputJsonValue
      updateData.remarks = employeeIntakeFormToRemarks(parsed)
    }

    if (body.closedSale !== undefined) {
      updateData.closedSale = body.closedSale
      metricsChanged = true
    }
    if (body.paymentReceived !== undefined) {
      updateData.paymentReceived = body.paymentReceived
      metricsChanged = true
    }
    if (body.verifiedSale !== undefined) {
      updateData.verifiedSale = body.verifiedSale
      metricsChanged = true
      if (body.verifiedSale === true && !existing.verifiedSale) {
        updateData.verifiedAt = new Date()
      }
      if (body.verifiedSale === false) {
        updateData.verifiedAt = null
      }
    }

    if (Object.keys(updateData).length === 0) {
      return NextResponse.json({ error: 'No fields to update' }, { status: 400 })
    }

    updateData.updatedAt = new Date()

    const updated = await db.lead.update({
      where: { id },
      data: updateData,
      select: ADMIN_LEAD_DETAIL_SELECT,
    })

    if (metricsChanged) invalidateAdminDashboardCache()

    return NextResponse.json({ success: true, lead: updated })
  } catch {
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}
