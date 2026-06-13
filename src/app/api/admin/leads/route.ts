import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { jwtVerify } from 'jose'
import type { Prisma } from '@prisma/client'
import { db } from '@/lib/db'
import { parseLeadPhoneForStorage } from '@/lib/phone'
import {
  employeeAssignUpdate,
  employeeUnassignUpdate,
  FRESH_UNASSIGNED_DISPOSITION,
  normalizeUnassignedLeadDispositions,
  unassignedEmployeeWhere,
} from '@/lib/lead-assignment'
import {
  classifyAssignmentBatch,
  inferSharedImportId,
  recordLeadAssignmentBatch,
} from '@/lib/lead-assignment-batch'
import { getJwtSecret } from '@/lib/jwt-secret'
import { ADMIN_LEADS_PAGE_SIZE } from '@/lib/admin-leads-config'
import {
  countCacheKey,
  getCachedCount,
  invalidateCountCache,
  setCachedCount,
} from '@/lib/admin-leads-count-cache'
import { invalidateAdminDashboardCache } from '@/lib/admin-dashboard-cache'
import { refreshDashboardStatsAfterLeadMutation } from '@/lib/dashboard-stats-snapshot'
import { leadSearchFilter, normalizeLeadSearch } from '@/lib/lead-search-filter'
import { friendlyServerImportError } from '@/lib/api-error-message'
import { normalizeLeadImportFileName } from '@/lib/lead-import-batch'
import { logQueryTiming, timed } from '@/lib/query-timing-log'
import { isMongoObjectId } from '@/lib/mongo-object-id'

const LOG_SCOPE = 'ADMIN LEADS'
const IMPORT_LOG_SCOPE = 'ADMIN LEADS IMPORT'
const secret = getJwtSecret()

export const preferredRegion = 'bom1'

/** Flat lead row — assignee names attached in a second batched query (faster than Prisma joins). */
const ADMIN_LEAD_LIST_SELECT = {
  id: true,
  title: true,
  firstName: true,
  lastName: true,
  email: true,
  phone: true,
  disposition: true,
  verifiedSale: true,
  paymentReceived: true,
  assignedToId: true,
  assignedAdvisorId: true,
} as const

type LeadListRow = {
  id: string
  title: string | null
  firstName: string | null
  lastName: string | null
  email: string | null
  phone: string
  disposition: string
  verifiedSale: boolean
  paymentReceived: boolean
  assignedToId: string | null
  assignedAdvisorId: string | null
}

async function attachAssigneeNames(rows: LeadListRow[]) {
  const userIds = new Set<string>()
  for (const row of rows) {
    if (row.assignedToId && isMongoObjectId(row.assignedToId)) {
      userIds.add(row.assignedToId)
    }
    if (row.assignedAdvisorId && isMongoObjectId(row.assignedAdvisorId)) {
      userIds.add(row.assignedAdvisorId)
    }
  }
  const nameById = new Map<string, string>()
  if (userIds.size > 0) {
    const userQueryStart = Date.now()
    try {
      const users = await db.user.findMany({
        where: { id: { in: [...userIds] } },
        select: { id: true, name: true },
      })
      logQueryTiming(LOG_SCOPE, 'attach names user query', Date.now() - userQueryStart, {
        ids: userIds.size,
        rows: users.length,
      })
      for (const u of users) nameById.set(u.id, u.name)
    } catch (userErr) {
      console.error('[ADMIN LEADS] attach names user query failed', userErr)
    }
  }
  const mapStart = Date.now()
  const result = rows.map(({ assignedToId, assignedAdvisorId, ...rest }) => ({
    ...rest,
    assignedTo:
      assignedToId && nameById.has(assignedToId)
        ? { name: nameById.get(assignedToId)! }
        : null,
    assignedAdvisor:
      assignedAdvisorId && nameById.has(assignedAdvisorId)
        ? { name: nameById.get(assignedAdvisorId)! }
        : null,
  }))
  logQueryTiming(LOG_SCOPE, 'attach names map', Date.now() - mapStart, { leads: rows.length })
  return result
}

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

/** Legacy leads uploaded before import batches — importId missing or explicitly null. */
function legacyImportWhere(): Prisma.LeadWhereInput {
  return {
    OR: [{ importId: null }, { importId: { isSet: false } }],
  }
}

function buildAdminLeadWhere(opts: {
  search?: string
  disposition?: string
  unassignedOnly?: boolean
  assignedToId?: string
  importId?: string
  ids?: string[]
}): Prisma.LeadWhereInput {
  const and: Prisma.LeadWhereInput[] = []

  if (opts.importId === 'none') {
    and.push(legacyImportWhere())
  } else if (opts.importId) {
    and.push({ importId: opts.importId })
  }

  if (opts.disposition && opts.disposition !== 'All') {
    and.push({ disposition: opts.disposition })
  }

  if (opts.assignedToId) {
    and.push({ assignedToId: opts.assignedToId })
  } else if (opts.unassignedOnly) {
    and.push(unassignedEmployeeWhere())
    // Assignable pool = no employee + New (legacy rows with other dispositions are excluded unless disposition filter set)
    if (!opts.disposition || opts.disposition === 'All') {
      and.push({ disposition: FRESH_UNASSIGNED_DISPOSITION })
    }
  }

  if (opts.ids?.length) {
    and.push({ id: { in: opts.ids } })
  }

  const searchFilter = leadSearchFilter(opts.search ?? '')
  if (searchFilter) and.push(searchFilter)

  return and.length ? { AND: and } : {}
}

type AdminLeadListFindArgs = {
  where: Prisma.LeadWhereInput
  skip: number
  take: number
}

async function findAdminLeadListRows(args: AdminLeadListFindArgs): Promise<LeadListRow[]> {
  const base = {
    where: args.where,
    select: ADMIN_LEAD_LIST_SELECT,
    skip: args.skip,
    take: args.take,
  }

  try {
    return await db.lead.findMany({ ...base, orderBy: { createdAt: 'desc' } })
  } catch (firstErr) {
    console.warn('[ADMIN LEADS] findMany orderBy createdAt failed, retrying id desc', firstErr)
    try {
      return await db.lead.findMany({ ...base, orderBy: { id: 'desc' } })
    } catch (secondErr) {
      console.warn('[ADMIN LEADS] findMany orderBy id failed, retrying without order', secondErr)
      return await db.lead.findMany(base)
    }
  }
}

async function findAdminLeadIds(args: AdminLeadListFindArgs): Promise<{ id: string }[]> {
  const base = {
    where: args.where,
    select: { id: true },
    skip: args.skip,
    take: args.take,
  }

  try {
    return await db.lead.findMany({ ...base, orderBy: { createdAt: 'desc' } })
  } catch (firstErr) {
    console.warn('[ADMIN LEADS] findMany ids orderBy createdAt failed, retrying id desc', firstErr)
    try {
      return await db.lead.findMany({ ...base, orderBy: { id: 'desc' } })
    } catch (secondErr) {
      console.warn('[ADMIN LEADS] findMany ids orderBy id failed, retrying without order', secondErr)
      return await db.lead.findMany(base)
    }
  }
}

export async function GET(req: NextRequest) {
  const token = req.cookies.get('token')?.value
  if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const reqStart = Date.now()

  try {
    const { payload } = await jwtVerify(token, secret)
    if (payload.role !== 'ADMIN') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

    const { searchParams } = new URL(req.url)
    const page = parsePositiveInt(searchParams.get('page'), 1)
    const idsOnly = searchParams.get('idsOnly') === 'true'
    const countOnly = searchParams.get('countOnly') === 'true'

    const pageSize = idsOnly
      ? parsePositiveInt(searchParams.get('pageSize'), ADMIN_LEADS_PAGE_SIZE, 5000)
      : ADMIN_LEADS_PAGE_SIZE

    const search = normalizeLeadSearch(searchParams.get('search'))
    const disposition = searchParams.get('disposition') ?? 'All'
    const unassignedOnly = searchParams.get('unassignedOnly') === 'true'
    const assignedToIdRaw = searchParams.get('assignedToId')?.trim() ?? ''
    const assignedToId =
      !unassignedOnly && assignedToIdRaw.length > 0 ? assignedToIdRaw : undefined
    const importIdRaw = searchParams.get('importId')?.trim() ?? ''
    const importId =
      importIdRaw === 'none' || importIdRaw.length > 0 ? importIdRaw : undefined
    const ids = uniqStrings(searchParams.get('ids')?.split(',') ?? [])

    const mode = countOnly ? 'countOnly' : idsOnly ? 'idsOnly' : 'list'

    if (unassignedOnly || searchParams.get('repairUnassigned') === 'true') {
      const repaired = await normalizeUnassignedLeadDispositions(db)
      if (repaired.count > 0) {
        invalidateCountCache()
        invalidateAdminDashboardCache()
        void refreshDashboardStatsAfterLeadMutation()
        console.log(
          `[${LOG_SCOPE}] normalized ${repaired.count} unassigned lead(s) to disposition New`
        )
      }
    }

    const where = buildAdminLeadWhere({
      search,
      disposition,
      unassignedOnly,
      assignedToId,
      importId,
      ids: ids.length ? ids : undefined,
    })

    const cacheKey = countCacheKey({
      search,
      disposition,
      unassignedOnly,
      assignedToId: assignedToId ?? '',
      importId: importId ?? '',
      idsKey: ids.join(','),
    })

    if (countOnly) {
      const cached = getCachedCount(cacheKey)
      if (cached != null) {
        logQueryTiming(LOG_SCOPE, 'count (cache hit)', Date.now() - reqStart, {
          mode,
          page,
        })
        const response = NextResponse.json({
          total: cached,
          totalPages: Math.max(1, Math.ceil(cached / ADMIN_LEADS_PAGE_SIZE)),
        })
        response.headers.set('Cache-Control', 'private, no-store')
        return response
      }

      const total = await timed(LOG_SCOPE, 'count', () => db.lead.count({ where }), {
        mode,
        page,
      })
      setCachedCount(cacheKey, total)
      logQueryTiming(LOG_SCOPE, 'GET total', Date.now() - reqStart, { mode, page })
      const response = NextResponse.json({
        total,
        totalPages: Math.max(1, Math.ceil(total / ADMIN_LEADS_PAGE_SIZE)),
      })
      response.headers.set('Cache-Control', 'private, no-store')
      return response
    }

    const skip = (page - 1) * pageSize
    const take = pageSize

    if (idsOnly) {
      const skipIdsTotal =
        searchParams.get('skipTotal') === 'true' ||
        searchParams.get('includeTotal') === 'false'

      if (skipIdsTotal) {
        const rows = await timed(
          LOG_SCOPE,
          'findMany idsOnly',
          () => findAdminLeadIds({ where, skip, take }),
          { mode, page, take }
        )
        logQueryTiming(LOG_SCOPE, 'GET total', Date.now() - reqStart, { mode, page, take })
        const response = NextResponse.json({
          ids: rows.map((r) => r.id),
          page,
          pageSize,
        })
        response.headers.set('Cache-Control', 'private, no-store')
        return response
      }

      const countStart = Date.now()
      const rowsPromise = findAdminLeadIds({ where, skip, take })
      const [total, rows] = await Promise.all([db.lead.count({ where }), rowsPromise])
      logQueryTiming(LOG_SCOPE, 'count', Date.now() - countStart, { mode, page, take })
      logQueryTiming(LOG_SCOPE, 'findMany idsOnly', Date.now() - countStart, {
        mode,
        page,
        take,
        parallel: true,
      })
      setCachedCount(cacheKey, total)
      logQueryTiming(LOG_SCOPE, 'GET total', Date.now() - reqStart, { mode, page, take })
      const response = NextResponse.json({
        ids: rows.map((r) => r.id),
        total,
        page,
        pageSize,
        totalPages: Math.max(1, Math.ceil(total / pageSize)),
      })
      response.headers.set('Cache-Control', 'private, no-store')
      return response
    }

    const rawRows = await timed(
      LOG_SCOPE,
      'findMany',
      () =>
        findAdminLeadListRows({
          where,
          skip,
          take: ADMIN_LEADS_PAGE_SIZE + 1,
        }),
      { mode, page }
    )
    const hasMore = rawRows.length > ADMIN_LEADS_PAGE_SIZE
    const leads = await timed(
      LOG_SCOPE,
      'attach names',
      () => attachAssigneeNames(rawRows.slice(0, ADMIN_LEADS_PAGE_SIZE)),
      { mode, page, rows: Math.min(rawRows.length, ADMIN_LEADS_PAGE_SIZE) }
    )

    logQueryTiming(LOG_SCOPE, 'GET total', Date.now() - reqStart, { mode, page })

    const response = NextResponse.json({
      leads,
      page,
      pageSize: ADMIN_LEADS_PAGE_SIZE,
      hasMore,
    })
    response.headers.set('Cache-Control', 'private, no-store')
    return response
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    console.error('[admin/leads GET]', detail, error)
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}

// POST, PUT, DELETE unchanged below...

export async function POST(req: NextRequest) {
  const token = req.cookies.get('token')?.value
  if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  try {
    const { payload } = await jwtVerify(token, secret)
    if (payload.role !== 'ADMIN') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

    const body = await req.json()
    const leadsData = body.leads as unknown
    const sourceFileName =
      typeof body.sourceFileName === 'string' ? body.sourceFileName : 'import'
    const fileName = normalizeLeadImportFileName(body.fileName, sourceFileName)
    const fileUrl =
      typeof body.fileUrl === 'string' && body.fileUrl.trim().length > 0
        ? body.fileUrl.trim()
        : null

    if (!Array.isArray(leadsData)) {
      return NextResponse.json(
        { error: 'No lead rows were sent. The file may be empty or could not be parsed.' },
        { status: 400 }
      )
    }

    if (leadsData.length === 0) {
      return NextResponse.json({ success: true, createdCount: 0, skippedCount: 0 })
    }

    if (leadsData.length > 10_000) {
      return NextResponse.json(
        { error: `Too many rows (${leadsData.length}). Import at most 10,000 leads per file.` },
        { status: 400 }
      )
    }

    console.log(`[${IMPORT_LOG_SCOPE}] start rows=${leadsData.length} file=${fileName}`)

    const leadImport = await db.leadImport.create({
      data: {
        fileName,
        fileUrl,
        uploadedById: typeof payload.id === 'string' ? payload.id : null,
      },
    })

    let createdCount = 0
    let skippedCount = 0

    const validLeads = leadsData.filter(
      (lead) => (lead.firstName || lead.lastName) && lead.phone != null && lead.phone !== ''
    )
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
          importId: leadImport.id,
        })
      }
    }

    if (newLeadsToInsert.length > 0) {
      await db.lead.createMany({ data: newLeadsToInsert })
      createdCount = newLeadsToInsert.length
      invalidateCountCache()
      invalidateAdminDashboardCache()
      void refreshDashboardStatsAfterLeadMutation()
    }

    console.log(
      `[${IMPORT_LOG_SCOPE}] done created=${createdCount} skipped=${skippedCount} received=${leadsData.length} importId=${leadImport.id}`
    )
    return NextResponse.json({
      success: true,
      createdCount,
      skippedCount,
      importId: leadImport.id,
      fileName: leadImport.fileName,
    })
  } catch (error) {
    console.error(`[${IMPORT_LOG_SCOPE}] failed`, error)
    return NextResponse.json({ error: friendlyServerImportError(error) }, { status: 500 })
  }
}

export async function PUT(req: NextRequest) {
  const token = req.cookies.get('token')?.value
  if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  try {
    const { payload } = await jwtVerify(token, secret)
    if (payload.role !== 'ADMIN') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

    const body = await req.json()
    const { leadIds, assignedToId, unassign: unassignFlag } = body

    const normalizedLeadIds = uniqStrings(leadIds)
    if (normalizedLeadIds.length === 0) {
      return NextResponse.json({ error: 'Select at least one lead.' }, { status: 400 })
    }

    const matchedCount = await db.lead.count({
      where: { id: { in: normalizedLeadIds } },
    })
    if (matchedCount === 0) {
      return NextResponse.json(
        {
          error:
            'None of the selected leads exist in the database. Deselect all, pick leads from the current import batch, and try again.',
          updatedCount: 0,
          requestedCount: normalizedLeadIds.length,
          matchedCount: 0,
        },
        { status: 400 }
      )
    }

    const shouldUnassign =
      unassignFlag === true ||
      assignedToId === null ||
      (typeof assignedToId === 'string' && assignedToId.trim() === '')

    const ownershipRows = await db.lead.findMany({
      where: { id: { in: normalizedLeadIds } },
      select: { assignedToId: true, importId: true },
    })
    const performedById = typeof payload.id === 'string' ? payload.id : null
    const sharedImportId = inferSharedImportId(ownershipRows)

    if (shouldUnassign) {
      const updated = await db.lead.updateMany({
        where: { id: { in: normalizedLeadIds } },
        data: employeeUnassignUpdate(),
      })

      invalidateCountCache()
      invalidateAdminDashboardCache()
      void refreshDashboardStatsAfterLeadMutation()

      if (updated.count === 0) {
        return NextResponse.json(
          {
            error: 'Unassign did not update any leads. Please try again.',
            updatedCount: 0,
            requestedCount: normalizedLeadIds.length,
            matchedCount,
          },
          { status: 500 }
        )
      }

      if (performedById) {
        const batchMeta = classifyAssignmentBatch(ownershipRows, null, true)
        void recordLeadAssignmentBatch(db, {
          action: batchMeta.action,
          leadCount: updated.count,
          previousEmployeeId: batchMeta.previousEmployeeId,
          importId: sharedImportId,
          performedById,
        })
      }

      return NextResponse.json({
        success: true,
        unassigned: true,
        updatedCount: updated.count,
        requestedCount: normalizedLeadIds.length,
        matchedCount,
      })
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

    // Assign or transfer — new owner + reset prior employee CRM work (disposition, intake, etc.).
    const updated = await db.lead.updateMany({
      where: { id: { in: normalizedLeadIds } },
      data: employeeAssignUpdate(employee.id),
    })

    invalidateCountCache()
    invalidateAdminDashboardCache()
    void refreshDashboardStatsAfterLeadMutation()

    if (updated.count === 0) {
      return NextResponse.json(
        {
          error: 'Assignment did not update any leads. Please try again.',
          updatedCount: 0,
          requestedCount: normalizedLeadIds.length,
          matchedCount,
        },
        { status: 500 }
      )
    }

    if (performedById) {
      const batchMeta = classifyAssignmentBatch(ownershipRows, employee.id, false)
      void recordLeadAssignmentBatch(db, {
        action: batchMeta.action,
        leadCount: updated.count,
        employeeId: batchMeta.employeeId,
        previousEmployeeId: batchMeta.previousEmployeeId,
        importId: sharedImportId,
        performedById,
      })
    }

    return NextResponse.json({
      success: true,
      updatedCount: updated.count,
      requestedCount: normalizedLeadIds.length,
      matchedCount,
      assignedToId: employee.id,
      assignedToName: employee.name,
    })
  } catch (error) {
    console.error('[admin/leads PUT]', error)
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
      where: { id: { in: normalizedLeadIds } },
    })
    if (deleted.count > 0) {
      invalidateCountCache()
      invalidateAdminDashboardCache()
      void refreshDashboardStatsAfterLeadMutation()
    }

    return NextResponse.json({ success: true, deletedCount: deleted.count })
  } catch {
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}
