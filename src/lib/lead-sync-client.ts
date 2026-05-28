/** Merge poll deltas into a list by id (newer updatedAt wins). */
export function mergeLeadDeltas<T extends { id: string; updatedAt: string | Date }>(
  current: T[],
  deltas: T[],
  opts?: { skipIds?: Set<string> }
): T[] {
  if (!deltas.length) return current
  const map = new Map<string, T>(current.map((l) => [l.id, l]))
  for (const d of deltas) {
    if (opts?.skipIds?.has(d.id)) continue
    const prev = map.get(d.id)
    const dTime = new Date(d.updatedAt).getTime()
    const pTime = prev ? new Date(prev.updatedAt).getTime() : 0
    // Only apply server delta if strictly newer (don't overwrite in-flight local edits)
    if (!prev || dTime > pTime) map.set(d.id, { ...prev, ...d })
  }
  return Array.from(map.values()) as T[]
}
