/** Short-lived cache for admin lead counts — avoids repeated slow count() on page flips. */
const TTL_MS = 45_000
const cache = new Map<string, { total: number; ts: number }>()

export function countCacheKey(filters: {
  search: string
  disposition: string
  unassignedOnly: boolean
  idsKey: string
}): string {
  return `${filters.search}|${filters.disposition}|${filters.unassignedOnly}|${filters.idsKey}`
}

export function getCachedCount(key: string): number | null {
  const hit = cache.get(key)
  if (!hit || Date.now() - hit.ts > TTL_MS) return null
  return hit.total
}

export function setCachedCount(key: string, total: number) {
  cache.set(key, { total, ts: Date.now() })
  if (cache.size > 40) {
    const oldest = [...cache.entries()].sort((a, b) => a[1].ts - b[1].ts)[0]?.[0]
    if (oldest) cache.delete(oldest)
  }
}

export function invalidateCountCache() {
  cache.clear()
}
