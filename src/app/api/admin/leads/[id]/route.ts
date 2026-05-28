import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { jwtVerify } from 'jose'
import { db } from '@/lib/db'
import { getJwtSecret } from '@/lib/jwt-secret'

const secret = getJwtSecret()

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const token = req.cookies.get('token')?.value
  if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  try {
    const { payload } = await jwtVerify(token, secret)
    if (payload.role !== 'ADMIN') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

    const { id } = await params
    const lead = await db.lead.findUnique({
      where: { id },
      select: {
        id: true,
        remarks: true,
        address: true,
        addressLine1: true,
        addressLine2: true,
        addressLine3: true,
        addressLine4: true,
        postCode: true,
        assignedTo: { select: { name: true } },
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
    if (payload.role !== 'ADMIN') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

    const { id } = await params
    const body = await req.json()

    const existing = await db.lead.findUnique({
      where: { id },
      select: { verifiedSale: true, verifiedAt: true },
    })

    const updateData: Record<string, unknown> = {}
    if (body.remarks !== undefined) updateData.remarks = body.remarks
    if (body.closedSale !== undefined) updateData.closedSale = body.closedSale
    if (body.paymentReceived !== undefined) updateData.paymentReceived = body.paymentReceived
    if (body.verifiedSale !== undefined) {
      updateData.verifiedSale = body.verifiedSale
      if (body.verifiedSale === true && !existing?.verifiedSale) updateData.verifiedAt = new Date()
      if (body.verifiedSale === false) updateData.verifiedAt = null
    }
    if (Object.keys(updateData).length > 0) {
      updateData.updatedAt = new Date()
    }

    const updated = await db.lead.update({
      where: { id },
      data: updateData,
      select: {
        id: true,
        remarks: true,
        verifiedSale: true,
        paymentReceived: true,
        updatedAt: true,
      },
    })

    return NextResponse.json({ success: true, lead: updated })
  } catch {
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}
