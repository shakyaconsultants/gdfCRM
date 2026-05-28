/**
 * Per-lead serial save queue — prevents one global debounce timer from
 * cancelling other employees' disposition saves when multiple leads update at once.
 */
export type LeadPatchResult<T = unknown> = {
  ok: boolean
  status: number
  data: T
}

export class LeadSaveQueue {
  private pending = new Map<string, Record<string, unknown>>()
  private timers = new Map<string, ReturnType<typeof setTimeout>>()
  private chains = new Map<string, Promise<LeadPatchResult | void>>()

  /** Merge patch; debounce flush for this lead only. */
  schedule(
    leadId: string,
    patch: Record<string, unknown>,
    save: (id: string, body: Record<string, unknown>) => Promise<LeadPatchResult>,
    debounceMs = 1000
  ) {
    const merged = { ...(this.pending.get(leadId) ?? {}), ...patch }
    this.pending.set(leadId, merged)
    const existing = this.timers.get(leadId)
    if (existing) clearTimeout(existing)
    this.timers.set(
      leadId,
      setTimeout(() => {
        this.timers.delete(leadId)
        void this.flush(leadId, save)
      }, debounceMs)
    )
  }

  /** Merge patch and save immediately (still queued behind prior saves for same lead). */
  enqueueNow(
    leadId: string,
    patch: Record<string, unknown>,
    save: (id: string, body: Record<string, unknown>) => Promise<LeadPatchResult>
  ) {
    const merged = { ...(this.pending.get(leadId) ?? {}), ...patch }
    this.pending.delete(leadId)
    const t = this.timers.get(leadId)
    if (t) {
      clearTimeout(t)
      this.timers.delete(leadId)
    }
    return this.run(leadId, merged, save)
  }

  hasPending(leadId: string) {
    return this.pending.has(leadId) || this.timers.has(leadId) || this.chains.has(leadId)
  }

  pendingLeadIds(): Set<string> {
    const ids = new Set<string>()
    for (const k of this.pending.keys()) ids.add(k)
    for (const k of this.timers.keys()) ids.add(k)
    for (const k of this.chains.keys()) ids.add(k)
    return ids
  }

  private flush(leadId: string, save: (id: string, body: Record<string, unknown>) => Promise<LeadPatchResult>) {
    const body = this.pending.get(leadId)
    if (!body) return Promise.resolve()
    this.pending.delete(leadId)
    return this.run(leadId, body, save)
  }

  private run(
    leadId: string,
    body: Record<string, unknown>,
    save: (id: string, body: Record<string, unknown>) => Promise<LeadPatchResult>
  ) {
    const prev = this.chains.get(leadId) ?? Promise.resolve()
    const job = prev
      .then(() => save(leadId, body))
      .catch((err): LeadPatchResult => ({
        ok: false,
        status: 0,
        data: { error: err instanceof Error ? err.message : 'Save failed' },
      }))
    this.chains.set(leadId, job.then(() => {}))
    return job
  }
}
