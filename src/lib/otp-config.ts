/** True when LOGIN_EMAIL OTP flow is configured (employees still skip OTP on first step). */
export function isGlobalOtpEnabled(): boolean {
  return !!process.env.ADMIN_EMAIL?.trim()
}

/**
 * Whether running WITHOUT OTP is permitted (audit SEC-1 / SEC-2).
 * - Development: always allowed (local convenience).
 * - Production: only when explicitly opted out via DISABLE_LOGIN_OTP=true,
 *   so a missing ADMIN_EMAIL can never silently disable the second factor.
 */
export function isOtpBypassAllowed(): boolean {
  if (process.env.NODE_ENV !== 'production') return true
  return process.env.DISABLE_LOGIN_OTP === 'true'
}
