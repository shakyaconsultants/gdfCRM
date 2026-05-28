import type { NextRequest } from 'next/server'

export function parsePositiveInt(
  value: string | null,
  fallback: number,
  max?: number
): number {
  const n = parseInt(value ?? '', 10)
  if (!Number.isFinite(n) || n < 1) return fallback
  if (max != null) return Math.min(n, max)
  return n
}

export function paginationFromRequest(
  req: NextRequest,
  defaults: { page?: number; pageSize?: number; maxPageSize?: number } = {}
) {
  const page = parsePositiveInt(
    req.nextUrl.searchParams.get('page'),
    defaults.page ?? 1
  )
  const pageSize = parsePositiveInt(
    req.nextUrl.searchParams.get('pageSize'),
    defaults.pageSize ?? 50,
    defaults.maxPageSize ?? 100
  )
  return { page, pageSize, skip: (page - 1) * pageSize }
}

export function parseSinceParam(value: string | null): Date | null {
  if (!value?.trim()) return null
  const d = new Date(value)
  return Number.isFinite(d.getTime()) ? d : null
}
