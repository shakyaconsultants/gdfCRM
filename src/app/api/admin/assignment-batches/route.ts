import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { jwtVerify } from 'jose'
import type { Prisma } from '@prisma/client'
import { db } from '@/lib/db'
import { getJwtSecret } from '@/lib/jwt-secret'
import { paginationFromRequest } from '@/lib/api-pagination'
import { FRESH_UNASSIGNED_DISPOSITION } from '@/lib/lead-assignment'
import { ASSIGNMENT_BATCH_ACTIONS } from '@/lib/lead-assignment-batch'

const secret = getJwtSecret()
const LOG_SCOPE = 'ADMIN ASSIGNMENT BATCHES'

export const preferredRegion = 'bom1'
export const runtime = 'nodejs'

function parseDateStart(value: string | null): Date | null {
  if (!value?.trim()) return null
  const d = new Date(`${value.trim()}T00:00:00.000Z`)
  return Number.isFinite(d.getTime()) ? d : null
}

function parseDateEnd(value: string | null): Date | null {
  if (!value?.trim()) return null
  const d = new Date(`${value.trim()}T23:59:59.999Z`)
  return Number.isFinite(d.getTime()) ? d : null
}

async function buildEmployeeWorkload() {
  const employees = await db.user.findMany({
    where: { role: 'EMPLOYEE' },
    select: { id: true, name: true, email: true },
    orderBy: { name: 'asc' },
  })

  const [totalRows, newRows, referredRows] = await Promise.all([
    db.lead.groupBy({
      by: ['assignedToId'],
      where: { assignedToId: { not: null } },
      _count: { _all: true },
    }),
    db.lead.groupBy({
      by: ['assignedToId'],
      where: { assignedToId: { not: null }, disposition: FRESH_UNASSIGNED_DISPOSITION },
      _count: { _all: true },
    }),
    db.lead.groupBy({
      by: ['assignedToId'],
      where: { assignedToId: { not: null }, moveToAdvisor: true },
      _count: { _all: true },
    }),
  ])

  const totalMap = new Map(
    totalRows
      .filter((r) => r.assignedToId)
      .map((r) => [r.assignedToId!, r._count._all])
  )
  const newMap = new Map(
    newRows.filter((r) => r.assignedToId).map((r) => [r.assignedToId!, r._count._all])
  )
  const referredMap = new Map(
    referredRows
      .filter((r) => r.assignedToId)
      .map((r) => [r.assignedToId!, r._count._all])
  )

  const unassignedPool = await db.lead.count({
    where: {
      OR: [{ assignedToId: null }, { assignedToId: { isSet: false } }],
      disposition: FRESH_UNASSIGNED_DISPOSITION,
    },
  })

  const workload = employees.map((emp) => {
    const totalAssigned = totalMap.get(emp.id) ?? 0
    const stillNew = newMap.get(emp.id) ?? 0
    const referredToAdvisor = referredMap.get(emp.id) ?? 0
    return {
      id: emp.id,
      name: emp.name,
      email: emp.email,
      totalAssigned,
      stillNew,
      inProgress: Math.max(0, totalAssigned - stillNew),
      referredToAdvisor,
    }
  })

  const assignedTotal = workload.reduce((sum, row) => sum + row.totalAssigned, 0)

  return {
    unassignedPool,
    assignedTotal,
    employees: workload.sort(
      (a, b) => b.totalAssigned - a.totalAssigned || a.name.localeCompare(b.name)
    ),
  }
}

export async function GET(req: NextRequest) {
  const token = req.cookies.get('token')?.value
  if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  try {
    const { payload } = await jwtVerify(token, secret)
    if (payload.role !== 'ADMIN') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

    const { searchParams } = req.nextUrl
    const includeWorkload = searchParams.get('workload') !== 'false'
    const { page, pageSize, skip } = paginationFromRequest(req, {
      pageSize: 30,
      maxPageSize: 100,
    })

    const actionRaw = searchParams.get('action')?.trim().toUpperCase() ?? ''
    const employeeId = searchParams.get('employeeId')?.trim() ?? ''
    const from = parseDateStart(searchParams.get('from'))
    const to = parseDateEnd(searchParams.get('to'))

    const where: Prisma.LeadAssignmentBatchWhereInput = {}
    const and: Prisma.LeadAssignmentBatchWhereInput[] = []

    if (actionRaw && ASSIGNMENT_BATCH_ACTIONS.includes(actionRaw as (typeof ASSIGNMENT_BATCH_ACTIONS)[number])) {
      and.push({ action: actionRaw })
    }
    if (employeeId) {
      and.push({
        OR: [{ employeeId }, { previousEmployeeId: employeeId }],
      })
    }
    if (from || to) {
      and.push({
        createdAt: {
          ...(from ? { gte: from } : {}),
          ...(to ? { lte: to } : {}),
        },
      })
    }
    if (and.length) where.AND = and

    let batchesReady = true
    let total = 0
    let rows: {
      id: string
      action: string
      leadCount: number
      employeeId: string | null
      previousEmployeeId: string | null
      importId: string | null
      performedById: string
      createdAt: Date
    }[] = []

    try {
      ;[total, rows] = await Promise.all([
        db.leadAssignmentBatch.count({ where }),
        db.leadAssignmentBatch.findMany({
          where,
          orderBy: { createdAt: 'desc' },
          skip,
          take: pageSize,
        }),
      ])
    } catch (err) {
      batchesReady = false
      console.warn(`[${LOG_SCOPE}] batch list unavailable — run npx prisma db push`, err)
    }

    const userIds = new Set<string>()
    const importIds = new Set<string>()
    for (const row of rows) {
      userIds.add(row.performedById)
      if (row.employeeId) userIds.add(row.employeeId)
      if (row.previousEmployeeId) userIds.add(row.previousEmployeeId)
      if (row.importId) importIds.add(row.importId)
    }

    const [users, imports] = await Promise.all([
      userIds.size
        ? db.user.findMany({
            where: { id: { in: [...userIds] } },
            select: { id: true, name: true },
          })
        : Promise.resolve([]),
      importIds.size
        ? db.leadImport.findMany({
            where: { id: { in: [...importIds] } },
            select: { id: true, fileName: true },
          })
        : Promise.resolve([]),
    ])

    const nameById = new Map(users.map((u) => [u.id, u.name]))
    const importNameById = new Map(imports.map((i) => [i.id, i.fileName]))

    const batches = rows.map((row) => ({
      id: row.id,
      action: row.action,
      leadCount: row.leadCount,
      employeeId: row.employeeId,
      employeeName: row.employeeId ? nameById.get(row.employeeId) ?? null : null,
      previousEmployeeId: row.previousEmployeeId,
      previousEmployeeName: row.previousEmployeeId
        ? nameById.get(row.previousEmployeeId) ?? null
        : null,
      importId: row.importId,
      importFileName: row.importId ? importNameById.get(row.importId) ?? null : null,
      performedById: row.performedById,
      performedByName: nameById.get(row.performedById) ?? 'Admin',
      createdAt: row.createdAt.toISOString(),
    }))

    const workload = includeWorkload ? await buildEmployeeWorkload() : undefined

    const response = NextResponse.json({
      batches,
      total,
      page,
      pageSize,
      totalPages: Math.max(1, Math.ceil(total / pageSize)),
      batchesReady,
      workload,
    })
    response.headers.set('Cache-Control', 'no-store')
    return response
  } catch (error) {
    console.error(`[${LOG_SCOPE}]`, error)
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}
