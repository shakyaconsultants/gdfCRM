export const MAX_CSV_IMPORT_BYTES = 8 * 1024 * 1024
export const MAX_LEAD_DOCUMENT_BYTES = 12 * 1024 * 1024

export const ALLOWED_LEAD_IMPORT_MIME = new Set([
  'text/csv',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-excel',
  'application/octet-stream',
])

export const ALLOWED_LEAD_DOCUMENT_MIME = new Set([
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'text/plain',
  'text/csv',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
])

export function hasAllowedMime(mime: string, allowed: Set<string>): boolean {
  const normalized = mime.toLowerCase().trim()
  if (!normalized) return false
  return allowed.has(normalized)
}

/**
 * Audit SEC-8: verify a buffer's magic bytes look like a real image instead of trusting
 * the client-supplied Content-Type. Covers the formats we accept (jpeg/png/gif/webp).
 */
export function sniffImageMime(buffer: Buffer): string | null {
  if (buffer.length < 12) return null
  // JPEG: FF D8 FF
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'image/jpeg'
  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47 &&
    buffer[4] === 0x0d &&
    buffer[5] === 0x0a &&
    buffer[6] === 0x1a &&
    buffer[7] === 0x0a
  ) {
    return 'image/png'
  }
  // GIF: "GIF87a" / "GIF89a"
  if (buffer.toString('ascii', 0, 6) === 'GIF87a' || buffer.toString('ascii', 0, 6) === 'GIF89a') {
    return 'image/gif'
  }
  // WEBP: "RIFF"...."WEBP"
  if (buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP') {
    return 'image/webp'
  }
  return null
}

