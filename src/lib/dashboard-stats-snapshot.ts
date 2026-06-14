import { subDays, format } from 'date-fns'
import type { Prisma, PrismaClient } from '@prisma/client'
import { db } from '@/lib/db'
import {
  buildAdminDashboardPayload,
  logDashboardBuildComplete,
  type AdminDashboardPayload,
} from '@/lib/build-admin-dashboard-payload'
import { logQueryTiming, timed } from '@/lib/query-timing-log'

const LOG_SCOPE = 'DASHBOARD SNAPSHOT'
export const DASHBOARD_SNAPSHOT_TTL_MS = 5 * 60 * 1000
const REFRESH_INTERVAL_MS = 5 * 60 * 1000

let schedulerStarted = false
let refreshInFlight = false

/** Coalesce concurrent cold builds for the same scope (e.g. React Strict Mode double-fetch). */
const buildsInFlight = new Map<string, Promise<AdminDashboardPayload>>()

export function dashboardScopeKey(fromKey: string | null, toKey: string | null): string {
  if (!fromKey || !toKey) return 'all'
  return `${fromKey}__${toKey}`
}

export function parseDashboardScopeKey(scopeKey: string): { gte: Date; lte: Date } | null {
  if (scopeKey === 'all') return null
  const sep = scopeKey.indexOf('__')
  if (sep === -1) return null
  const from = scopeKey.slice(0, sep)
  const to = scopeKey.slice(sep + 2)
  const gte = new Date(from + 'T00:00:00.000')
  const lte = new Date(to + 'T23:59:59.999')
  if (Number.isNaN(gte.getTime()) || Number.isNaN(lte.getTime()) || gte > lte) return null
  return { gte, lte }
}

function defaultRolling30dScope(): { scopeKey: string; range: { gte: Date; lte: Date } } {
  const to = new Date()
  const from = subDays(to, 30)
  const fromKey = format(from, 'yyyy-MM-dd')
  const toKey = format(to, 'yyyy-MM-dd')
  return {
    scopeKey: dashboardScopeKey(fromKey, toKey),
    range: {
      gte: new Date(fromKey + 'T00:00:00.000'),
      lte: new Date(toKey + 'T23:59:59.999'),
    },
  }
}

export async function readDashboardSnapshot(scopeKey: string) {
  const row = await db.dashboardStats.findFirst({
    where: { scopeKey },
    orderBy: { updatedAt: 'desc' },
    select: { payload: true, updatedAt: true },
  })
  if (!row) return null
  return {
    payload: row.payload as AdminDashboardPayload,
    ageMs: Date.now() - row.updatedAt.getTime(),
    updatedAt: row.updatedAt,
  }
}

export async function refreshDashboardSnapshot(
  client: PrismaClient,
  scopeKey: string,
  range: { gte: Date; lte: Date } | null,
  options?: { background?: boolean }
): Promise<AdminDashboardPayload> {
  const start = Date.now()
  const fromKey = range ? scopeKey.split('__')[0] ?? 'all' : 'all'
  const toKey = range ? scopeKey.split('__')[1] ?? 'all' : 'all'
  const logMeta = {
    scope: scopeKey,
    from: fromKey,
    to: toKey,
    background: options?.background ? 1 : 0,
  }

  if (!options?.background) {
    console.log('CACHE MISS', scopeKey, '(live build starting)')
  }

  const payload = await buildAdminDashboardPayload(client, range, {
    background: options?.background,
    logMeta,
  })
  const jsonPayload = payload as unknown as Prisma.InputJsonValue

  await client.dashboardStats.upsert({
    where: { scopeKey },
    create: { scopeKey, payload: jsonPayload },
    update: { payload: jsonPayload },
  })

  const verify = await readDashboardSnapshot(scopeKey)
  if (!verify) {
    console.error('[DASHBOARD SNAPSHOT] STORED but read-back failed', scopeKey)
  } else {
    console.log('[DASHBOARD SNAPSHOT] STORED', scopeKey)
  }

  logDashboardBuildComplete(Date.now() - start, logMeta)
  return payload
}

function getOrStartColdBuild(
  scopeKey: string,
  range: { gte: Date; lte: Date } | null
): Promise<AdminDashboardPayload> {
  const existing = buildsInFlight.get(scopeKey)
  if (existing) {
    console.log('[DASHBOARD SNAPSHOT] awaiting in-flight build', scopeKey)
    return existing
  }

  const build = refreshDashboardSnapshot(db, scopeKey, range)
    .finally(() => {
      buildsInFlight.delete(scopeKey)
    })

  buildsInFlight.set(scopeKey, build)
  return build
}

export async function refreshDashboardSnapshotByKey(scopeKey: string, background = true) {
  const range = parseDashboardScopeKey(scopeKey)
  return refreshDashboardSnapshot(db, scopeKey, range, { background })
}

/** Minimum gap between mutation-triggered refreshes (audit PERF-2 debounce). */
const MUTATION_REFRESH_DEBOUNCE_MS = 30 * 1000
let lastMutationRefreshAt = 0

/**
 * After bulk lead changes, refresh ONLY the two "hot" scopes (all-time + rolling 30d).
 * Audit PERF-2: previously this rebuilt EVERY stored scope — each a 24+ query payload —
 * so a single "assign 5,000 leads" click could kick off dozens of full recomputations.
 * Every other date scope now refreshes lazily on next view via the existing
 * stale-while-revalidate path in getDashboardFromSnapshot(). A short debounce coalesces
 * bursts of mutations (the busiest operation).
 */
export async function refreshDashboardStatsAfterLeadMutation() {
  const now = Date.now()
  if (now - lastMutationRefreshAt < MUTATION_REFRESH_DEBOUNCE_MS) {
    return
  }
  lastMutationRefreshAt = now

  const rolling = defaultRolling30dScope()
  await Promise.all([
    refreshDashboardSnapshot(db, 'all', null, { background: true }).catch((err) => {
      console.error('[DASHBOARD SNAPSHOT] refresh failed', 'all', err)
    }),
    refreshDashboardSnapshot(db, rolling.scopeKey, rolling.range, { background: true }).catch(
      (err) => {
        console.error('[DASHBOARD SNAPSHOT] refresh failed', rolling.scopeKey, err)
      }
    ),
  ])
}

function refreshScheduledScopes() {
  if (refreshInFlight) return
  refreshInFlight = true
  const rolling = defaultRolling30dScope()
  Promise.all([
    refreshDashboardSnapshot(db, 'all', null, { background: true }),
    refreshDashboardSnapshot(db, rolling.scopeKey, rolling.range, { background: true }),
  ])
    .catch((err) => console.error('[DASHBOARD SNAPSHOT] scheduled refresh failed', err))
    .finally(() => {
      refreshInFlight = false
    })
}

/** Warm all-time + default 30d snapshots every 5 minutes (cPanel single Node). */
export function ensureDashboardSnapshotScheduler() {
  if (schedulerStarted) return
  schedulerStarted = true

  void refreshScheduledScopes()
  setInterval(refreshScheduledScopes, REFRESH_INTERVAL_MS).unref?.()
}

export async function getDashboardFromSnapshot(
  scopeKey: string,
  range: { gte: Date; lte: Date } | null
): Promise<{ payload: AdminDashboardPayload; source: 'snapshot' | 'snapshot-stale' | 'cold-build' }> {
  ensureDashboardSnapshotScheduler()

  const snapshot = await timed(LOG_SCOPE, 'dashboardStats findFirst', () =>
    readDashboardSnapshot(scopeKey)
  )

  if (snapshot) {
    console.log('CACHE HIT', scopeKey, `(snapshot age ${snapshot.ageMs}ms)`)

    if (snapshot.ageMs >= DASHBOARD_SNAPSHOT_TTL_MS) {
      void refreshDashboardSnapshot(db, scopeKey, range, { background: true }).catch((err) => {
        console.error('[DASHBOARD SNAPSHOT] background refresh failed', scopeKey, err)
      })
      logQueryTiming(LOG_SCOPE, 'serve stale snapshot', snapshot.ageMs, { scope: scopeKey })
      return { payload: snapshot.payload, source: 'snapshot-stale' }
    }

    logQueryTiming(LOG_SCOPE, 'serve fresh snapshot', snapshot.ageMs, { scope: scopeKey })
    return { payload: snapshot.payload, source: 'snapshot' }
  }

  console.log('CACHE MISS', scopeKey, '(no snapshot in DB)')

  const payload = await timed(LOG_SCOPE, 'cold snapshot build', () =>
    getOrStartColdBuild(scopeKey, range)
  )
  return { payload, source: 'cold-build' }
}
