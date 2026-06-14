import type { Prisma } from '@prisma/client'

/** Avoid full-collection regex scans on short admin/employee search input. */
export const MIN_LEAD_SEARCH_LENGTH = 3

/** Returns trimmed query for DB search, or empty if too short. */
export function normalizeLeadSearch(raw: string | null | undefined): string {
  const q = (raw ?? '').trim()
  if (!q || q.length < MIN_LEAD_SEARCH_LENGTH) return ''
  return q
}

export function leadSearchFilter(search: string): Prisma.LeadWhereInput | undefined {
  const q = normalizeLeadSearch(search)
  if (!q) return undefined

  // Audit PERF-1: for purely numeric queries (phone lookups — the most common search)
  // add an anchored prefix term, which CAN use the unique `phone` index instead of a
  // full-collection regex scan. We keep `contains` as a fallback so no existing match is
  // lost (e.g. when phones are stored with a country-code prefix).
  const digits = q.replace(/\D/g, '')
  const isPhoneLike = /^[+\d][\d\s-]*$/.test(q) && digits.length >= 3

  return {
    OR: [
      // Audit PERF-1: case-insensitive for correctness ("john" matches "John").
      { firstName: { contains: q, mode: 'insensitive' } },
      { lastName: { contains: q, mode: 'insensitive' } },
      { email: { contains: q, mode: 'insensitive' } },
      ...(isPhoneLike
        ? [{ phone: { startsWith: digits } }, { phone: { contains: q } }]
        : [{ phone: { contains: q } }]),
    ],
  }
}

export function mergeLeadWhere(
  ...parts: (Prisma.LeadWhereInput | undefined)[]
): Prisma.LeadWhereInput {
  const and = parts.filter((p): p is Prisma.LeadWhereInput => !!p && Object.keys(p).length > 0)
  if (!and.length) return {}
  return and.length === 1 ? and[0] : { AND: and }
}
