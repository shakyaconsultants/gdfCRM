import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { jwtVerify } from 'jose'
import { db } from '@/lib/db'
import { getJwtSecret } from '@/lib/jwt-secret'
import { logQueryTiming, timed } from '@/lib/query-timing-log'

const LOG_SCOPE = 'ADMIN LEAD IMPORTS'
const secret = getJwtSecret()

export const preferredRegion = 'bom1'
export const runtime = 'nodejs'

const legacyLeadWhere = {
  OR: [{ importId: null }, { importId: { isSet: false } }],
}

export async function GET(req: NextRequest) {
  const token = req.cookies.get('token')?.value
  if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const reqStart = Date.now()

  try {
    const { payload } = await jwtVerify(token, secret)
    if (payload.role !== 'ADMIN') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

    const legacyCount = await timed(
      LOG_SCOPE,
      'legacy count',
      () => db.lead.count({ where: legacyLeadWhere }),
      {}
    )

    type ImportRow = {
      id: string
      fileName: string
      fileUrl: string | null
      createdAt: Date
      _count: { leads: number }
    }

    let rows: ImportRow[] = []
    let importsReady = true

    const leadImportDb = (
      db as typeof db & {
        leadImport?: {
          findMany: (args: unknown) => Promise<ImportRow[]>
        }
      }
    ).leadImport

    if (leadImportDb) {
      try {
        rows = await timed(
          LOG_SCOPE,
          'findMany',
          () =>
            leadImportDb.findMany({
              orderBy: { createdAt: 'desc' },
              take: 500,
              select: {
                id: true,
                fileName: true,
                fileUrl: true,
                createdAt: true,
                _count: { select: { leads: true } },
              },
            }),
          {}
        )
      } catch (batchErr) {
        importsReady = false
        console.warn(`[${LOG_SCOPE}] batch list failed`, batchErr)
      }
    } else {
      importsReady = false
      console.warn(
        `[${LOG_SCOPE}] LeadImport model missing — run npx prisma generate && npx prisma db push`
      )
    }

    logQueryTiming(LOG_SCOPE, 'GET total', Date.now() - reqStart, { batches: rows.length })

    const response = NextResponse.json({
      imports: rows.map((r) => ({
        id: r.id,
        fileName: r.fileName,
        fileUrl: r.fileUrl,
        createdAt: r.createdAt,
        leadCount: r._count.leads,
      })),
      legacyCount,
      importsReady,
    })
    response.headers.set('Cache-Control', 'private, no-store')
    return response
  } catch (error) {
    console.error('[admin/lead-imports GET]', error)
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}
