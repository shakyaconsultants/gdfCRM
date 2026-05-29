import type { NextRequest } from 'next/server'

/**
 * Optional `from` and `to` as YYYY-MM-DD (inclusive of both days, local time).
 * Returns null for all-time (no range) or if invalid.
 */
export function getLeadUpdatedAtRange(
  searchParams: URLSearchParams
): { gte: Date; lte: Date } | null {
  const from = searchParams.get('from')
  const to = searchParams.get('to')
  if (!from || !to) return null
  const gte = new Date(from + 'T00:00:00.000')
  const lte = new Date(to + 'T23:59:59.999')
  if (Number.isNaN(gte.getTime()) || Number.isNaN(lte.getTime()) || gte > lte) return null
  return { gte, lte }
}

export function getLeadUpdatedAtRangeFromRequest(req: NextRequest) {
  return getLeadUpdatedAtRange(new URL(req.url).searchParams)
}

/** Stable cache keys from raw query params — do not re-encode dates via toISOString(). */
export function getDashboardRequestContext(req: NextRequest) {
  const searchParams = new URL(req.url).searchParams
  const fromParam = searchParams.get('from')
  const toParam = searchParams.get('to')
  const range = getLeadUpdatedAtRange(searchParams)
  const hasRange = range != null && !!fromParam && !!toParam

  return {
    range,
    fromKey: hasRange ? fromParam! : null,
    toKey: hasRange ? toParam! : null,
    scopeKey: hasRange ? `${fromParam}__${toParam}` : 'all',
    cacheKey: hasRange ? `dash:${fromParam}:${toParam}` : 'dash:all:all',
  }
}
