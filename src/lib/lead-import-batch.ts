/** Normalize admin-provided import label or fall back to uploaded filename. */
export function normalizeLeadImportFileName(input: unknown, fallbackFileName: string): string {
  const trimmed = typeof input === 'string' ? input.trim() : ''
  const base = trimmed.length > 0 ? trimmed : fallbackFileName.trim() || 'import'
  return base.slice(0, 200)
}
