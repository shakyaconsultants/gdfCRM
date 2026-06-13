/** Merge poll deltas into a list by id (newer updatedAt wins). Preserves existing row order. */
export function mergeLeadDeltas<T extends { id: string; updatedAt: string | Date }>(
  current: T[],
  deltas: T[],
  opts?: { skipIds?: Set<string> }
): T[] {
  if (!deltas.length) return current

  const map = new Map<string, T>()
  for (const l of current) map.set(l.id, l)

  const incomingNew: T[] = []
  for (const d of deltas) {
    if (opts?.skipIds?.has(d.id)) continue
    const prev = map.get(d.id)
    const dTime = new Date(d.updatedAt).getTime()
    const pTime = prev ? new Date(prev.updatedAt).getTime() : 0
    if (!prev || dTime > pTime) {
      const merged = prev ? { ...prev, ...d } : d
      map.set(d.id, merged)
      if (!prev) incomingNew.push(merged)
    }
  }

  const existingIds = new Set(current.map((l) => l.id))
  const updatedCurrent = current.map((l) => map.get(l.id) ?? l)
  const prepend = incomingNew.filter((l) => !existingIds.has(l.id))
  return prepend.length ? [...prepend, ...updatedCurrent] : updatedCurrent
}
