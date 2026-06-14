/**
 * Centralized password + image-URL policy (audit SEC-8).
 * - One bcrypt cost across the app.
 * - Bounded password length (min for strength, max to prevent bcrypt CPU-DoS).
 * - Cloudinary host allowlist for stored image URLs.
 */
export const BCRYPT_COST = 12
export const MIN_PASSWORD_LENGTH = 8
export const MAX_PASSWORD_LENGTH = 128

/** Returns an error message if invalid, otherwise null. */
export function validatePasswordInput(value: unknown): string | null {
  if (typeof value !== 'string' || value.length === 0) {
    return 'Password is required.'
  }
  if (value.length < MIN_PASSWORD_LENGTH) {
    return `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`
  }
  if (value.length > MAX_PASSWORD_LENGTH) {
    return `Password must be at most ${MAX_PASSWORD_LENGTH} characters.`
  }
  return null
}

/**
 * Accept only https Cloudinary URLs for stored profile images (audit SEC-8).
 * Empty / nullish input returns null (caller treats as "no image").
 */
export function sanitizeImageUrl(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (!trimmed) return null
  let url: URL
  try {
    url = new URL(trimmed)
  } catch {
    return null
  }
  if (url.protocol !== 'https:') return null
  const host = url.hostname.toLowerCase()
  // Cloudinary delivery hosts, e.g. res.cloudinary.com
  if (host === 'res.cloudinary.com' || host.endsWith('.cloudinary.com')) {
    return trimmed
  }
  return null
}
