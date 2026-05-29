/** Structured timing logs for production DB profiling (cPanel / Node logs). */
export function logQueryTiming(
  scope: string,
  label: string,
  ms: number,
  meta?: Record<string, string | number | boolean>
) {
  const extra = meta
    ? ' ' +
      Object.entries(meta)
        .map(([k, v]) => `${k}=${v}`)
        .join(' ')
    : ''
  console.log(`[${scope}] ${label}: ${ms} ms${extra}`)
}

export async function timed<T>(
  scope: string,
  label: string,
  fn: () => Promise<T>,
  meta?: Record<string, string | number | boolean>
): Promise<T> {
  const start = Date.now()
  try {
    return await fn()
  } finally {
    logQueryTiming(scope, label, Date.now() - start, meta)
  }
}
