/** In-memory admin dashboard response cache (single cPanel Node instance). */
const TTL_MS = 30_000

type Entry = { data: unknown; ts: number }

const store = new Map<string, Entry>()

export function adminDashboardCacheKey(from: string | null, to: string | null): string {
  return `dash:${from ?? 'all'}:${to ?? 'all'}`
}

export function getAdminDashboardCache(key: string): unknown | null {
  const hit = store.get(key)
  if (!hit || Date.now() - hit.ts > TTL_MS) return null
  return hit.data
}

export function setAdminDashboardCache(key: string, data: unknown) {
  store.set(key, { data, ts: Date.now() })
  if (store.size > 16) {
    const oldest = [...store.entries()].sort((a, b) => a[1].ts - b[1].ts)[0]?.[0]
    if (oldest) store.delete(oldest)
  }
}

export function invalidateAdminDashboardCache() {
  store.clear()
}
