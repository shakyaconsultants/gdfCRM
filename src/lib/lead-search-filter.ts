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
  return {
    OR: [
      { firstName: { contains: q } },
      { lastName: { contains: q } },
      { email: { contains: q } },
      { phone: { contains: q } },
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
