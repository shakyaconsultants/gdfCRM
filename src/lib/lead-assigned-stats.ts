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
