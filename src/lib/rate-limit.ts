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

export type RateLimitResult = { allowed: boolean; retryAfterSec: number }

function checkInMemory(opts: { key: string; limit: number; windowMs: number }): RateLimitResult {
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

/**
 * Shared (distributed) rate limiting via Upstash Redis REST — used when
 * UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN are configured (audit SEC-5).
 * On Vercel's multi-instance runtime this is the only way limits actually hold.
 * Falls back to in-memory automatically when env is absent or Redis errors.
 */
const REDIS_URL = process.env.UPSTASH_REDIS_REST_URL?.trim()
const REDIS_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN?.trim()
const redisEnabled = !!(REDIS_URL && REDIS_TOKEN)

async function redisPipeline(commands: (string | number)[][]): Promise<unknown[] | null> {
  if (!redisEnabled) return null
  try {
    const res = await fetch(`${REDIS_URL}/pipeline`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${REDIS_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(commands),
      cache: 'no-store',
    })
    if (!res.ok) return null
    const data = (await res.json()) as { result?: unknown }[]
    return data.map((d) => d.result)
  } catch {
    return null
  }
}

async function checkRedis(opts: {
  key: string
  limit: number
  windowMs: number
}): Promise<RateLimitResult | null> {
  const windowSec = Math.max(1, Math.ceil(opts.windowMs / 1000))
  const redisKey = `rl:${opts.key}`
  // INCR then set expiry only on first hit (NX) — atomic enough for limiting.
  const results = await redisPipeline([
    ['INCR', redisKey],
    ['EXPIRE', redisKey, windowSec, 'NX'],
    ['TTL', redisKey],
  ])
  if (!results) return null
  const count = Number(results[0] ?? 0)
  const ttl = Number(results[2] ?? windowSec)
  const retryAfterSec = ttl > 0 ? ttl : windowSec
  if (count > opts.limit) {
    return { allowed: false, retryAfterSec }
  }
  return { allowed: true, retryAfterSec }
}

/**
 * Async rate limit check. Uses distributed Redis store when configured,
 * otherwise the in-memory fallback. Always resolves (never throws).
 */
export async function checkRateLimit(opts: {
  key: string
  limit: number
  windowMs: number
}): Promise<RateLimitResult> {
  if (redisEnabled) {
    const viaRedis = await checkRedis(opts)
    if (viaRedis) return viaRedis
  }
  return checkInMemory(opts)
}

/** Synchronous in-memory check, for non-critical paths that can't await. */
export function checkRateLimitSync(opts: {
  key: string
  limit: number
  windowMs: number
}): RateLimitResult {
  return checkInMemory(opts)
}
