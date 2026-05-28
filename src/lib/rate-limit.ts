import type { NextRequest } from 'next/server'

type Bucket = { count: number; resetAt: number }

const buckets = new Map<string, Bucket>()
const MAX_BUCKETS = 2000

function now() {
  return Date.now()
}

function pruneBuckets() {
  if (buckets.size < MAX_BUCKETS) return
  const ts = now()
  for (const [key, b] of buckets) {
    if (b.resetAt <= ts) buckets.delete(key)
  }
  if (buckets.size > MAX_BUCKETS) {
    let n = 0
    for (const key of buckets.keys()) {
      buckets.delete(key)
      if (++n > 500) break
    }
  }
}

export function getClientIp(req: NextRequest): string {
  const forwarded = req.headers.get('x-forwarded-for')
  if (forwarded) return forwarded.split(',')[0]?.trim() || 'unknown'
  return req.headers.get('x-real-ip') || 'unknown'
}

export function checkRateLimit(opts: {
  key: string
  limit: number
  windowMs: number
}): { allowed: boolean; retryAfterSec: number } {
  pruneBuckets()
  const ts = now()
  const current = buckets.get(opts.key)

  if (!current || current.resetAt <= ts) {
    buckets.set(opts.key, { count: 1, resetAt: ts + opts.windowMs })
    return { allowed: true, retryAfterSec: Math.ceil(opts.windowMs / 1000) }
  }

  if (current.count >= opts.limit) {
    return {
      allowed: false,
      retryAfterSec: Math.max(1, Math.ceil((current.resetAt - ts) / 1000)),
    }
  }

  current.count += 1
  buckets.set(opts.key, current)
  return {
    allowed: true,
    retryAfterSec: Math.max(1, Math.ceil((current.resetAt - ts) / 1000)),
  }
}
