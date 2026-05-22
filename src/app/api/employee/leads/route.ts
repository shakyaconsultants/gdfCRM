import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { enforceEmployeeWithCrm } from '@/lib/enforce-employee-auth'

export async function GET(req: NextRequest) {
  const gated = await enforceEmployeeWithCrm(req)
  if (gated instanceof NextResponse) return gated

  try {
    const leads = await db.lead.findMany({
      where: { assignedToId: gated.userId },
      select: {
        id: true,
        title: true,
        firstName: true,
        lastName: true,
        email: true,
        address: true,
        addressLine1: true,
        addressLine2: true,
        addressLine3: true,
        addressLine4: true,
        postCode: true,
        phone: true,
        disposition: true,
        remarks: true,
        employeeIntakeForm: true,
        moveToAdvisor: true,
        assignedAdvisorId: true,
        closedSale: true,
        verifiedSale: true,
        paymentReceived: true,
        caseStatus: true,
        callbackAt: true,
        updatedAt: true,
      },
      orderBy: { assignedDate: 'desc' },
    })

    const response = NextResponse.json({ leads })
    response.headers.set('Cache-Control', 'no-store')
    return response
  } catch {
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}
