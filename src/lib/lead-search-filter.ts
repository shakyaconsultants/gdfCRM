import type { Prisma } from '@prisma/client'

export function leadSearchFilter(search: string): Prisma.LeadWhereInput | undefined {
  const q = search.trim()
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
