import type { PrismaClient } from '@prisma/client'
import { verifiedInMonthFilter } from '@/lib/verified-month'

/** One groupBy instead of N count() calls per employee. */
export async function verifiedCountsByEmployee(
  db: PrismaClient,
  monthStart: Date,
  monthEnd: Date
): Promise<Map<string, number>> {
  const monthFilter = verifiedInMonthFilter(monthStart, monthEnd)
  try {
    const rows = await db.lead.groupBy({
      by: ['assignedToId'],
      where: {
        assignedToId: { not: null },
        ...monthFilter,
      },
      _count: { _all: true },
    })
    const map = new Map<string, number>()
    for (const r of rows) {
      if (r.assignedToId) map.set(r.assignedToId, r._count._all)
    }
    return map
  } catch (err) {
    // Fallback if verifiedAt filter fails on stale Prisma client
    console.error('[verifiedCountsByEmployee] primary groupBy failed, using fallback', err)
    const rows = await db.lead.groupBy({
      by: ['assignedToId'],
      where: {
        assignedToId: { not: null },
        verifiedSale: true,
        updatedAt: { gte: monthStart, lte: monthEnd },
      },
      _count: { _all: true },
    })
    const map = new Map<string, number>()
    for (const r of rows) {
      if (r.assignedToId) map.set(r.assignedToId, r._count._all)
    }
    return map
  }
}
