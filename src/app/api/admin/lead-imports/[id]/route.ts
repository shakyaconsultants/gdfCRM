import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { jwtVerify } from 'jose'
import { db } from '@/lib/db'
import { getJwtSecret } from '@/lib/jwt-secret'
import { normalizeLeadImportFileName } from '@/lib/lead-import-batch'
import { invalidateCountCache } from '@/lib/admin-leads-count-cache'
import { invalidateAdminDashboardCache } from '@/lib/admin-dashboard-cache'
import { refreshDashboardStatsAfterLeadMutation } from '@/lib/dashboard-stats-snapshot'

const secret = getJwtSecret()
const LOG_SCOPE = 'ADMIN LEAD IMPORT'

export const preferredRegion = 'bom1'
export const runtime = 'nodejs'
export const maxDuration = 60

async function requireAdmin(req: NextRequest) {
  const token = req.cookies.get('token')?.value
  if (!token) return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }

  try {
    const { payload } = await jwtVerify(token, secret)
    if (payload.role !== 'ADMIN') {
      return { error: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) }
    }
    return { payload }
  } catch {
    return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  }
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAdmin(req)
  if ('error' in auth && auth.error) return auth.error

  try {
    const { id } = await params
    const body = await req.json()
    const trimmed = typeof body.fileName === 'string' ? body.fileName.trim() : ''
    if (!trimmed) {
      return NextResponse.json({ error: 'Enter a file name.' }, { status: 400 })
    }
    const fileName = normalizeLeadImportFileName(trimmed, trimmed)

    const existing = await db.leadImport.findUnique({
      where: { id },
      select: { id: true },
    })
    if (!existing) {
      return NextResponse.json({ error: 'Import batch not found.' }, { status: 404 })
    }

    const updated = await db.leadImport.update({
      where: { id },
      data: { fileName },
      select: { id: true, fileName: true, fileUrl: true, createdAt: true },
    })

    return NextResponse.json({ success: true, import: updated })
  } catch (error) {
    console.error(`[${LOG_SCOPE} PATCH]`, error)
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAdmin(req)
  if ('error' in auth && auth.error) return auth.error

  try {
    const { id } = await params

    const batch = await db.leadImport.findUnique({
      where: { id },
      select: {
        id: true,
        fileName: true,
        _count: { select: { leads: true } },
      },
    })
    if (!batch) {
      return NextResponse.json({ error: 'Import batch not found.' }, { status: 404 })
    }

    const deletedLeads = await db.lead.deleteMany({ where: { importId: id } })
    await db.leadImport.delete({ where: { id } })

    invalidateCountCache()
    invalidateAdminDashboardCache()
    void refreshDashboardStatsAfterLeadMutation()

    console.log(
      `[${LOG_SCOPE}] deleted batch=${id} file=${batch.fileName} leads=${deletedLeads.count}`
    )

    return NextResponse.json({
      success: true,
      deletedLeadCount: deletedLeads.count,
      fileName: batch.fileName,
    })
  } catch (error) {
    console.error(`[${LOG_SCOPE} DELETE]`, error)
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}
