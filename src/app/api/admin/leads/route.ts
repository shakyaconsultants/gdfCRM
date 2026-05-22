import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { jwtVerify } from 'jose'
import type { Prisma } from '@prisma/client'
import { db } from '@/lib/db'
import { parseLeadPhoneForStorage } from '@/lib/phone'
import { employeeAssignUpdate } from '@/lib/lead-assignment'
import { getJwtSecret } from '@/lib/jwt-secret'

const secret = getJwtSecret()

/** List view fields only — omit heavy JSON blobs so large lead pools load in production. */
const ADMIN_LEAD_LIST_SELECT = {
  id: true,
  title: true,
  firstName: true,
  lastName: true,
  email: true,
  address: true,
  addressLine1: true,
  addressLine2: true,
  addressLine3: true,
  addressLine4: true,
  postCode: true,
  phone: true,
  assignedToId: true,
  assignedAdvisorId: true,
  assignedDate: true,
  disposition: true,
  remarks: true,
  moveToAdvisor: true,
  closedSale: true,
  verifiedSale: true,
  paymentReceived: true,
  createdAt: true,
  updatedAt: true,
  assignedTo: { select: { name: true } },
  assignedAdvisor: { select: { name: true } },
} as const

export const runtime = 'nodejs'
export const maxDuration = 60

function uniqStrings(input: unknown): string[] {
  if (!Array.isArray(input)) return []
  return Array.from(
    new Set(input.filter((x): x is string => typeof x === 'string' && x.trim().length > 0))
  )
}

function parsePositiveInt(value: string | null, fallback: number, max?: number): number {
  const n = parseInt(value ?? '', 10)
  if (!Number.isFinite(n) || n < 1) return fallback
  if (max != null) return Math.min(n, max)
  return n
}

function buildAdminLeadWhere(opts: {
  search?: string
  disposition?: string
  unassignedOnly?: boolean
  ids?: string[]
}): Prisma.LeadWhereInput {
  const and: Prisma.LeadWhereInput[] = []

  if (opts.disposition && opts.disposition !== 'All') {
    and.push({ disposition: opts.disposition })
  }

  if (opts.unassignedOnly) {
    and.push({ assignedToId: null })
  }

  if (opts.ids?.length) {
    and.push({ id: { in: opts.ids } })
  }

  const search = opts.search?.trim()
  if (search) {
    and.push({
      OR: [
        { firstName: { contains: search } },
        { lastName: { contains: search } },
        { email: { contains: search } },
        { phone: { contains: search } },
      ],
    })
  }

  return and.length ? { AND: and } : {}
}

export async function GET(req: NextRequest) {
  const token = req.cookies.get('token')?.value
  if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  try {
    const { payload } = await jwtVerify(token, secret)
    if (payload.role !== 'ADMIN') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

    const { searchParams } = new URL(req.url)
    const page = parsePositiveInt(searchParams.get('page'), 1)
    const pageSize = parsePositiveInt(searchParams.get('pageSize'), 50, 100)
    const search = searchParams.get('search')?.trim() ?? ''
    const disposition = searchParams.get('disposition') ?? 'All'
    const unassignedOnly = searchParams.get('unassignedOnly') === 'true'
    const idsOnly = searchParams.get('idsOnly') === 'true'
    const ids = uniqStrings(searchParams.get('ids')?.split(',') ?? [])

    const where = buildAdminLeadWhere({ search, disposition, unassignedOnly, ids: ids.length ? ids : undefined })

    const total = await db.lead.count({ where })

    if (idsOnly) {
      const rows = await db.lead.findMany({
        where,
        select: { id: true },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      })
      const response = NextResponse.json({
        ids: rows.map((r) => r.id),
        total,
        page,
        pageSize,
        totalPages: Math.max(1, Math.ceil(total / pageSize)),
      })
      response.headers.set('Cache-Control', 'no-store')
      return response
    }

    const leads = await db.lead.findMany({
      where,
      select: ADMIN_LEAD_LIST_SELECT,
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
    })

    const response = NextResponse.json({
      leads,
      total,
      page,
      pageSize,
      totalPages: Math.max(1, Math.ceil(total / pageSize)),
    })
    response.headers.set('Cache-Control', 'no-store')
    return response
  } catch (error) {
    console.error('[admin/leads GET]', error)
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
    const leadsData = body.leads as any[]

    if (!Array.isArray(leadsData)) {
      return NextResponse.json({ error: 'No data provided' }, { status: 400 })
    }

    if (leadsData.length === 0) {
      return NextResponse.json({ success: true, createdCount: 0, skippedCount: 0 })
    }

    let createdCount = 0
    let skippedCount = 0

    // Filter out rows missing essential data
    const validLeads = leadsData.filter((lead) => (lead.firstName || lead.lastName) && lead.phone != null && lead.phone !== '')
    skippedCount += leadsData.length - validLeads.length

    const phoneNumbers = validLeads
      .map((l) => parseLeadPhoneForStorage(l.phone))
      .filter((p): p is string => !!p)
    const uniquePhones = Array.from(new Set(phoneNumbers))
    const existingLeads = uniquePhones.length
      ? await db.lead.findMany({
          where: { phone: { in: uniquePhones } },
          select: { phone: true },
        })
      : []
    const existingPhonesSet = new Set(existingLeads.map((l) => l.phone))

    const newLeadsToInsert = []

    const seenPhonesInCsv = new Set<string>()

    for (const lead of validLeads) {
      const phoneStr = parseLeadPhoneForStorage(lead.phone)
      if (!phoneStr) {
        skippedCount++
        continue
      }
      if (existingPhonesSet.has(phoneStr) || seenPhonesInCsv.has(phoneStr)) {
        skippedCount++
      } else {
        seenPhonesInCsv.add(phoneStr)
        const addressLine1 =
          lead.addressLine1 != null ? String(lead.addressLine1) : lead.address1 != null ? String(lead.address1) : ''
        const addressLine2 =
          lead.addressLine2 != null ? String(lead.addressLine2) : lead.address2 != null ? String(lead.address2) : ''
        const addressLine3 =
          lead.addressLine3 != null ? String(lead.addressLine3) : lead.address3 != null ? String(lead.address3) : ''
        const addressLine4 =
          lead.addressLine4 != null ? String(lead.addressLine4) : lead.address4 != null ? String(lead.address4) : ''
        const legacyAddress = lead.address ? String(lead.address) : ''
        const mergedAddress =
          [addressLine1, addressLine2, addressLine3, addressLine4].filter(Boolean).join(', ') ||
          legacyAddress ||
          null
        newLeadsToInsert.push({
            title: lead.title ? String(lead.title) : null,
            firstName: lead.firstName ? String(lead.firstName) : '',
            lastName: lead.lastName ? String(lead.lastName) : null,
            email: lead.email ? String(lead.email).trim().toLowerCase() : null,
            address: mergedAddress,
            addressLine1: addressLine1 || null,
            addressLine2: addressLine2 || null,
            addressLine3: addressLine3 || null,
            addressLine4: addressLine4 || null,
            postCode: lead.postCode ? String(lead.postCode) : null,
            phone: phoneStr,
            remarks: lead.remarks ? String(lead.remarks) : null,
        })
      }
    }

    if (newLeadsToInsert.length > 0) {
      await db.lead.createMany({
        data: newLeadsToInsert,
      })
      createdCount = newLeadsToInsert.length
    }

    return NextResponse.json({ success: true, createdCount, skippedCount })
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

    const body = await req.json()
    const { leadIds, assignedToId } = body

    const normalizedLeadIds = uniqStrings(leadIds)
    if (normalizedLeadIds.length === 0) {
      return NextResponse.json({ error: 'Select at least one lead.' }, { status: 400 })
    }

    const targetId =
      typeof assignedToId === 'string' && assignedToId.trim() !== ''
        ? assignedToId.trim()
        : null

    if (!targetId) {
      return NextResponse.json({ error: 'Select an employee to assign leads.' }, { status: 400 })
    }

    const employee = await db.user.findUnique({
      where: { id: targetId },
      select: { id: true, role: true, name: true },
    })
    if (!employee || employee.role !== 'EMPLOYEE') {
      return NextResponse.json({ error: 'Invalid employee selection' }, { status: 400 })
    }

    // Only set owner + date — never clear assignment or reset disposition/intake on assign/transfer.
    const updated = await db.lead.updateMany({
      where: { id: { in: normalizedLeadIds } },
      data: employeeAssignUpdate(employee.id),
    })

    return NextResponse.json({
      success: true,
      updatedCount: updated.count,
      assignedToId: employee.id,
      assignedToName: employee.name,
    })
  } catch (error) {
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}

export async function DELETE(req: NextRequest) {
  const token = req.cookies.get('token')?.value
  if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  try {
    const { payload } = await jwtVerify(token, secret)
    if (payload.role !== 'ADMIN') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

    const { leadIds } = await req.json()
    const normalizedLeadIds = uniqStrings(leadIds)
    if (normalizedLeadIds.length === 0) {
      return NextResponse.json({ error: 'No leads selected' }, { status: 400 })
    }

    const deleted = await db.lead.deleteMany({
      where: { id: { in: normalizedLeadIds } }
    })

    return NextResponse.json({ success: true, deletedCount: deleted.count })
  } catch (error) {
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}
