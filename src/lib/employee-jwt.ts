import type { JWTPayload } from 'jose'
import { isGlobalOtpEnabled, isOtpBypassAllowed } from '@/lib/otp-config'
import { CRM_SESSION_JWT_PURPOSE } from '@/lib/employee-crm-session'

export type AppJwtClaims = JWTPayload & {
  role?: string
  crm?: boolean
  purpose?: string
}

export function employeeHasCrmAccess(payload: AppJwtClaims): boolean {
  if (payload.role !== 'EMPLOYEE') return false
  // Audit SEC-1: a missing ADMIN_EMAIL must not silently unlock CRM in production.
  if (!isGlobalOtpEnabled()) return isOtpBypassAllowed()
  if (payload.purpose === CRM_SESSION_JWT_PURPOSE && payload.crm === true) return true
  return payload.crm === true
}
