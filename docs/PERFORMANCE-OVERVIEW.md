# Performance work — full overview (May 2026)

This document is the narrative record of performance work on **GDF Internationals / Bee CRM**: what was slow, what we changed, how we verified it, and what is still open. It is written for the team and for senior review.

For system architecture see **[ARCHITECTURE.md](./ARCHITECTURE.md)**. For a shorter implementation checklist see **[PERFORMANCE-IMPLEMENTATION.md](./PERFORMANCE-IMPLEMENTATION.md)**.

---

## 1. Executive summary

| Area | Before | After | Status |
|------|--------|-------|--------|
| Admin leads list | ~2.2s+ per page | ~500ms typical | **Healthy** |
| Lead total count | Full count every load | 45s in-memory cache + separate `countOnly` | **Healthy** |
| `/api/user` | Occasional ~2.4s spikes | Simple `findUnique`; timing logs added | **Acceptable** (DB latency spikes possible) |
| Admin dashboard | ~5.5s every open | Target **100–300ms** on repeat loads via Mongo snapshot | **Checkpoint pending deploy verify** |
| Background nav prefetch | Storm of admin route prefetches | `prefetch={false}` on all admin links | **Done** |
| DB indexes | Weak single-field | Compound indexes on Lead + `User.role` | **Done** (requires `prisma db push`) |
| Vercel region | `iad1` (Virginia) | `preferredRegion = 'bom1'` on hot APIs | **Done** (Vercel only; cPanel N/A) |

**Bottom line:** The CRM was never fundamentally broken because of 40k leads. The leads pipeline was optimized successfully. The remaining bottleneck was the **admin dashboard running 24+ live database operations on every cache miss**. The fix is a **precomputed MongoDB snapshot** (`DashboardStats`), not more query tuning on the hot path.

---

## 2. Production context

- **Stack:** Next.js 16 App Router, React 19, Prisma 6, MongoDB Atlas, JWT auth
- **Deploy:** cPanel via `server.js` → `.next/standalone` (`output: 'standalone'`)
- **Scale:** ~**40,000+ leads**, growing
- **Users:** Primarily India; Atlas cluster in **Mumbai**
- **Some traffic** also hit **Vercel** (`region = iad1`) — cross-region latency added hundreds of ms per request when DB is in Mumbai

---

## 3. Original symptoms

1. **Heavy CPU / memory** on shared hosting (cPanel) and slow admin experience
2. **Admin Leads tab** felt unusable — loading too many records, slow pagination
3. **Admin Dashboard** consistently ~**5 seconds**
4. Many admin routes appeared to load in the background (prefetch)
5. `/api/user` sometimes spiked to ~2.4s in logs

---

## 4. What was *not* the problem

Evidence from profiling after the leads work:

- Lead list API: **~500ms** — good for 40k+ collection with pagination
- Count cache hits: **~0–1ms**
- Compound indexes on Lead: working
- Search with **minimum 3 characters**: prevents expensive `contains` scans on 1–2 char queries

**Conclusion:** Lead volume alone does not explain slowness. The dashboard aggregation pattern does.

---

## 5. What *was* the problem (dashboard)

Every dashboard open (on cache miss) executed roughly:

| Block | Typical time |
|-------|----------------|
| Load advisors + assessors (`User` filtered by `role`) | ~1,280ms |
| KPI counts + recent activity (7× `count`, 1× `findMany`) | ~1,260–1,980ms |
| `buildAdvisorPerformance` (5× `groupBy`) | ~1,250ms |
| `buildEmployeeLeaderboard` (3× `groupBy`) | ~800ms+ |
| `buildAssessorPerformance` (5× `groupBy`) | ~800ms+ |
| Assessor assigned count | ~200ms+ |
| **Total** | **~5,000–5,500ms** |

That is **24+ database round-trips** per request, mostly counts and aggregations over the full lead collection (optionally filtered by `updatedAt` date range).

The admin UI defaults to a **30-day date range**, so most sessions hit filtered-but-still-heavy aggregation.

---

## 6. Work completed — by area

### 6.1 Admin leads (`/admin/leads`)

**Issues:** Full lead payloads, count on every page, N+1 assignee lookups, no search guard, 50/page not enforced server-side.

**Changes:**

| Change | Detail |
|--------|--------|
| Fixed page size | `ADMIN_LEADS_PAGE_SIZE = 50` in `src/lib/admin-leads-config.ts` |
| Slim list query | `findMany` with minimal `select`; detail on row expand via `GET /api/admin/leads/[id]` |
| Pagination | Fetch 51 rows → return 50 + `hasMore` (no total count on every page turn) |
| Count cache | Separate `countOnly` query with **45s** in-memory cache (`admin-leads-count-cache.ts`) |
| Batched assignee names | `attachAssigneeNames()` — one `user.findMany` by IDs, inline in leads route (not N+1 joins) |
| Search guard | Min **3 characters** via `src/lib/lead-search-filter.ts` |
| Bulk select preserved | `idsOnly` for select-all (up to 5000) and AUTO SELECT (QTY) kept per product decision |
| Timing logs | `[ADMIN LEADS]` scope via `query-timing-log.ts` |
| Cache invalidation | Count + dashboard caches cleared on import / assign / delete |

**Result:** List loads dropped from ~2.2s toward **~500ms** in production logs.

---

### 6.2 Database indexes (`prisma/schema.prisma`)

**Lead** — replaced weak singles with compound indexes aligned to list/filter patterns:

```
@@index([createdAt(sort: Desc)])
@@index([assignedToId, createdAt(sort: Desc)])
@@index([assignedAdvisorId, createdAt(sort: Desc)])
@@index([assignedCaseAssessorId, createdAt(sort: Desc)])
@@index([disposition, createdAt(sort: Desc)])
@@index([updatedAt(sort: Desc)])
```

**User** — dashboard repeatedly filters by role:

```
@@index([role])
```

**Production step (required once):**

```bash
npx prisma db push
# restart Node app
```

Run off-peak on large collections; index build uses CPU briefly.

---

### 6.3 Query timing / profiling infrastructure

**File:** `src/lib/query-timing-log.ts`

Structured stdout logs for cPanel / Node:

```
[SCOPE] label: N ms key=value ...
```

Scopes in use:

| Scope | Route / area |
|-------|----------------|
| `[ADMIN LEADS]` | `/api/admin/leads` |
| `[ADMIN DASHBOARD]` | Live build blocks + GET total |
| `[DASHBOARD SNAPSHOT]` | Mongo snapshot read / cold build |
| `[DASHBOARD PROFILE]` | Inside `admin-aggregations.ts` build functions |
| `[USER API]` | `/api/user` |

**Principle adopted:** Measure first, optimize second — do not guess.

---

### 6.4 Admin dashboard — evolution of caching

#### Phase A — In-memory only (first pass)

**File:** `src/lib/admin-dashboard-cache.ts`

- 30s TTL per date-range key (`dash:from:to`)
- Logs: `CACHE HIT` / `CACHE MISS`
- Cleared on lead import / assign / delete

**Limitation:** Only helps **same Node process** within TTL. cPanel single instance OK; Vercel serverless = new instance per request = always miss. Still ran full 24-query build on every miss.

#### Phase B — MongoDB snapshot (`DashboardStats`)

**Problem identified:** In-memory cache alone cannot fix ~5s dashboard; need **one read** instead of 24 queries.

**Schema addition:**

```prisma
model DashboardStats {
  id        String   @id @default(auto()) @map("_id") @db.ObjectId
  scopeKey  String   @unique   // "all" or "2025-04-28__2025-05-28"
  payload   Json      // full dashboard API response
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
}
```

**Files:**

| File | Role |
|------|------|
| `src/lib/build-admin-dashboard-payload.ts` | Live 24-query aggregation (cold build + background refresh only) |
| `src/lib/dashboard-stats-snapshot.ts` | Read / upsert snapshot, scheduler, dedup |
| `src/lib/adminDateRange.ts` | `getDashboardRequestContext()` — stable keys from URL params |
| `src/app/api/admin/dashboard/route.ts` | Hot path: memory → Mongo snapshot → cold build |

**Read path (target):**

1. **L1 — Memory cache** (5 min TTL, same Node instance)
2. **L2 — Mongo snapshot** (`dashboardStats.findFirst` by `scopeKey`) → **100–300ms**
3. **L3 — Cold build** (once per scope) → ~5s, then `upsert` snapshot

**Refresh strategy:**

- **Every 5 minutes:** background refresh for `all` + rolling 30d scope (scheduler on first dashboard hit)
- **After lead import / assign / delete:** rebuild all known scopes in background
- **Stale-while-revalidate:** if snapshot older than 5 min, **serve stale immediately** and refresh in background

**Scope keys:** Raw URL params (`2025-04-28__2025-05-28`), **not** `toISOString()` re-encoding (timezone-safe).

---

### 6.5 Snapshot cache bugs found and fixed

After first snapshot implementation, profiling still showed `buildAdvisorPerformance` and `kpi counts` on repeat loads — snapshot was **not** serving requests.

| Bug | Effect | Fix |
|-----|--------|-----|
| `invalidateAdminDashboardCache()` inside every snapshot build | Wiped memory cache right after storing | Removed from build path; only invalidate on lead mutations |
| Scope key from `toISOString()` | Key drift vs client `?from=&to=` | Use raw query params via `getDashboardRequestContext()` |
| No in-flight dedup | Two parallel requests = two cold builds | `buildsInFlight` Map per `scopeKey` |
| Background refresh logged live build timings | Looked like cache failure in logs | `background: true` skips `[ADMIN DASHBOARD]` block timings |
| 15s delayed scheduler start | Slow warm-up | Scheduler runs immediately on first dashboard access |
| Short memory TTL (30s) | Easy miss on reload | Extended to **5 minutes** |

---

### 6.6 Navigation prefetch

**Issue:** Next.js `<Link prefetch>` prefetched many admin routes when the nav rendered → background API/render load.

**Fix:** `prefetch={false}` on all **9 admin nav links** (desktop + mobile) in `src/components/Navigation.tsx`.

---

### 6.7 `/api/user`

**Issue:** Occasional ~2.4s spikes vs ~200ms baseline.

**Finding:** Route is already minimal — JWT verify + `user.findUnique` by id, no joins. Spikes are likely **Mongo cold connection / Atlas latency**, not application logic.

**Changes:** `[USER API]` timing logs for jwt / prisma / total.

**Optional:** `export const preferredRegion = 'bom1'` (Vercel) to reduce India ↔ Virginia latency.

---

### 6.8 Vercel region preference

Added to hot API routes:

```typescript
export const preferredRegion = 'bom1'
```

**Files:**

- `src/app/api/user/route.ts`
- `src/app/api/admin/dashboard/route.ts`
- `src/app/api/admin/leads/route.ts`

**Note:** Only applies on **Vercel**. cPanel Node app is unaffected.

---

### 6.9 Other UX / bug fixes (same initiative)

| Item | Resolution |
|------|------------|
| Logout / back button | Session handling fixes |
| Admin nav glitch | Navigation state fixes |
| Concurrent disposition saves | Save queue / conflict handling |
| Select-all / deselect | Preserved bulk select; DESELECT ALL; page behavior documented |
| Architecture doc | `docs/ARCHITECTURE.md` for senior review |

---

## 7. Verification checkpoint (dashboard)

**Do not optimize queries further until this passes.**

### Deploy steps

```bash
npm run build
npx prisma db push    # creates DashboardStats collection + indexes
# restart Node app on cPanel
```

### Load 1 — cold (expect ~5s once)

```
CACHE MISS dash:2025-04-28:2025-05-28
CACHE MISS 2025-04-28__2025-05-28 (no snapshot in DB)
CACHE MISS 2025-04-28__2025-05-28 (live build starting)
[ADMIN DASHBOARD] buildAdvisorPerformance: ~1250 ms    ← OK on load 1 only
[ADMIN DASHBOARD] kpi counts + recent activity: ~1260 ms
[DASHBOARD SNAPSHOT] STORED 2025-04-28__2025-05-28
[ADMIN DASHBOARD] GET total (cold build — expect ~5s once): ~5486 ms
```

### Load 2 — same date range (the test)

**Must see:**

```
CACHE HIT dash:2025-04-28:2025-05-28 (memory age …ms)
[ADMIN DASHBOARD] GET total (memory CACHE HIT): 100-300 ms
```

**Or** (different server instance, e.g. Vercel):

```
CACHE HIT 2025-04-28__2025-05-28 (snapshot age …ms)
[ADMIN DASHBOARD] GET total (snapshot CACHE HIT): 100-300 ms
```

**Must NOT see on load 2:**

- `buildAdvisorPerformance`
- `kpi counts + recent activity`
- `load advisors/assessors`

If load 2 shows `CACHE MISS … (no snapshot in DB)` and load 1 never logged `STORED`, **`prisma db push` was not applied** or the app is pointing at a different database.

---

## 8. Intentionally not done (deferred)

| Item | Reason |
|------|--------|
| Redis / external cache | Single cPanel instance + Mongo snapshot sufficient for now |
| Cursor pagination | Senior priority 5 deferred; offset pagination kept |
| Further leads optimization | Leads already ~500ms; “leave leads alone” |
| Denormalize assignee names on `Lead` | Discussed; not implemented |
| Bulk delete with OTP | Product decision — deferred |
| Sort unassigned + New first | Deferred |
| Page-only select-all | Kept full bulk select + AUTO SELECT per user request |
| Instant dashboard refresh on every employee/advisor disposition | 5 min scheduler + import refresh; can wire later if needed |
| Advisor dashboard page (`/admin/advisors`) | Separate API `/api/admin/advisors/dashboard` — not yet snapshotted |

---

## 9. What may still need attention

1. **Confirm dashboard snapshot checkpoint** in production logs after deploy + `db push`
2. **Advisor / assessor admin sub-dashboards** — still live aggregation if slow
3. **`/api/user` spikes** — if persistent, investigate Atlas tier, connection pooling, or region
4. **Disposition updates from CRM** — dashboard snapshot may be up to **5 minutes stale** unless import/assign/delete triggers refresh; wire more mutation hooks if real-time KPIs are required
5. **Vercel vs cPanel** — clarify primary production host; region preference only helps Vercel
6. **Background scheduler on serverless** — 5 min interval runs per warm instance; Mongo snapshot is the cross-instance layer

---

## 10. Key files reference

| Area | Path |
|------|------|
| Admin leads API | `src/app/api/admin/leads/route.ts` |
| Assignee name batching | Same file — `attachAssigneeNames()` |
| Admin leads UI | `src/app/admin/leads/page.tsx` |
| Dashboard API | `src/app/api/admin/dashboard/route.ts` |
| Live dashboard build | `src/lib/build-admin-dashboard-payload.ts` |
| Mongo snapshot layer | `src/lib/dashboard-stats-snapshot.ts` |
| Memory cache (L1) | `src/lib/admin-dashboard-cache.ts` |
| Aggregations | `src/lib/admin-aggregations.ts` |
| Date range + cache keys | `src/lib/adminDateRange.ts` |
| Count cache | `src/lib/admin-leads-count-cache.ts` |
| Search filter | `src/lib/lead-search-filter.ts` |
| Timing helper | `src/lib/query-timing-log.ts` |
| Navigation prefetch off | `src/components/Navigation.tsx` |
| User API | `src/app/api/user/route.ts` |
| Prisma schema | `prisma/schema.prisma` |
| Production entry | `server.js` |

---

## 11. Log grep cheat sheet (cPanel stderr/stdout)

```text
[ADMIN LEADS]           — leads list / count timing
CACHE HIT               — memory or snapshot hit (see suffix)
CACHE MISS              — memory or snapshot miss
[DASHBOARD SNAPSHOT] STORED — snapshot persisted to Mongo
[ADMIN DASHBOARD] GET total — end-to-end dashboard request
[USER API]              — user session endpoint
```

---

## 12. Recommended next steps (priority order)

1. Deploy latest build + **`npx prisma db push`**
2. Run **dashboard checkpoint** (load 1 cold, load 2 must show `CACHE HIT` + ~100–300ms)
3. If checkpoint fails — paste load 1 + load 2 log lines; do not tune queries until snapshot read works
4. If checkpoint passes — optionally snapshot **advisor/assessor dashboard** APIs the same way
5. Monitor `[USER API]` spikes; consider Atlas region / pool settings if ongoing

---

## 13. Story in one paragraph

We started with a CRM that felt slow on shared hosting at 40k leads. Profiling showed the **leads list** was fixable with pagination, slimmer queries, batched assignee lookups, count caching, indexes, and search guards — and it is now **healthy at ~500ms**. The **dashboard** was the real problem: every open ran **24+ aggregation queries** taking ~5 seconds. We added profiling, indexes, disabled admin prefetch, and moved through in-memory caching to a **MongoDB `DashboardStats` snapshot** that should serve repeat loads in **100–300ms**. Early snapshot code had bugs (cache invalidation on build, unstable scope keys, no dedup) that made it *look* like caching failed; those are fixed. The team’s immediate job is to **verify `CACHE HIT` on the second dashboard load** after deploy. Everything else — Redis, cursor pagination, real-time KPIs on every disposition — is deliberately deferred until the snapshot checkpoint passes.

---

*Last updated: May 2026 — reflects dashboard snapshot fixes and verification checkpoint.*
