import type { Prisma } from '@prisma/client'
import type { PrismaClient } from '@prisma/client'

export type AssignedLeadStats = {
  total: number
  dropped: number
  verified: number
  clawbacks: number
  referred: number
}

export async function countAssignedLeadStats(
  db: PrismaClient,
  where: Prisma.LeadWhereInput
): Promise<AssignedLeadStats> {
  const [total, dropped, verified, clawbacks, referred] = await Promise.all([
    db.lead.count({ where }),
    db.lead.count({ where: { ...where, closedSale: true } }),
    db.lead.count({ where: { ...where, verifiedSale: true } }),
    db.lead.count({ where: { ...where, caseStatus: 'CLAWBACK' } }),
    db.lead.count({
      where: {
        ...where,
        OR: [{ moveToAdvisor: true }, { assignedAdvisorId: { not: null } }],
      },
    }),
  ])
  return { total, dropped, verified, clawbacks, referred }
}

/**
 * Audit PERF-3: the CRM panel requests stats on every poll. These 5 count scans per
 * active employee add up fast, so we cache per-key for a short TTL. Safe because the
 * numbers are approximate progress badges, not authoritative figures.
 */
const STATS_TTL_MS = 60_000
const statsCache = new Map<string, { value: AssignedLeadStats; expiresAt: number }>()

export async function countAssignedLeadStatsCached(
  db: PrismaClient,
  where: Prisma.LeadWhereInput,
  cacheKey: string,
  ttlMs: number = STATS_TTL_MS
): Promise<AssignedLeadStats> {
  const now = Date.now()
  const hit = statsCache.get(cacheKey)
  if (hit && hit.expiresAt > now) return hit.value

  const value = await countAssignedLeadStats(db, where)
  statsCache.set(cacheKey, { value, expiresAt: now + ttlMs })

  if (statsCache.size > 1000) {
    for (const [k, v] of statsCache) {
      if (v.expiresAt <= now) statsCache.delete(k)
    }
  }
  return value
}

/** Invalidate a cached stats entry (e.g. after a known mutation). */
export function invalidateAssignedLeadStats(cacheKey: string): void {
  statsCache.delete(cacheKey)
}
