/** Read a user-facing message from a JSON API error response. */
export async function apiErrorMessage(res: Response, fallback: string): Promise<string> {
  try {
    const data = (await res.json()) as { error?: string; message?: string }
    if (typeof data.error === 'string' && data.error.trim()) return data.error
    if (typeof data.message === 'string' && data.message.trim()) return data.message
  } catch {
    /* non-JSON */
  }
  if (res.status === 401) return 'Session expired — please log in again.'
  if (res.status === 403) return 'You do not have permission for this action.'
  if (res.status === 503) return 'Service temporarily unavailable. Try again shortly.'
  if (res.status === 413) return 'Request too large.'
  return fallback
}

/** Map server/import exceptions to safe user messages (full detail stays in logs). */
export function friendlyServerImportError(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err ?? '')
  const lower = raw.toLowerCase()

  if (lower.includes('unique constraint') || lower.includes('duplicate key') || lower.includes('e11000')) {
    return 'Some phone numbers already exist in the system. Duplicates were skipped — try importing again with only new leads.'
  }
  if (lower.includes('prisma') && lower.includes('connect')) {
    return 'Could not connect to the database. Try again in a moment.'
  }
  if (lower.includes('document is too large') || lower.includes('too large')) {
    return 'Import payload is too large. Split the file into smaller batches.'
  }
  return 'Import failed on the server. Check the file and try again. If it keeps failing, contact support.'
}
