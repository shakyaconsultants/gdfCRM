# Performance optimizations — implementation log (May 2026)

Senior developer priorities 1–4 implemented. Priority 5 (cursor pagination) deferred intentionally.

## Priority 1 — Query timing logs

**Files:** `src/lib/query-timing-log.ts`, `src/app/api/admin/leads/route.ts`, `src/app/api/admin/dashboard/route.ts`

Logs appear in **cPanel Node application logs** (stdout):

```
[ADMIN LEADS] findMany: 142 ms mode=list page=1
[ADMIN LEADS] attach names: 8 ms mode=list page=1 rows=50
[ADMIN LEADS] count: 890 ms mode=countOnly page=1
[ADMIN LEADS] count (cache hit): 1 ms mode=countOnly page=1
[ADMIN LEADS] GET total: 156 ms mode=list page=1
[ADMIN DASHBOARD] metrics bundle: 4200 ms from=all to=all
[ADMIN DASHBOARD] GET total (cache hit): 0 ms from=all to=all
```

Use these to decide next optimizations — do not guess.

## Priority 2 — Compound indexes

**File:** `prisma/schema.prisma`

Replaced single-field indexes with:

- `createdAt` (desc)
- `assignedToId + createdAt` (desc)
- `assignedAdvisorId + createdAt` (desc)
- `assignedCaseAssessorId + createdAt` (desc)
- `disposition + createdAt` (desc)
- `updatedAt` (desc)

**Production required:**

```bash
npx prisma db push
# restart Node app
```

Run off-peak on ~40k leads (index build uses CPU briefly).

## Priority 3 — Search minimum 3 characters

**Files:** `src/lib/lead-search-filter.ts`, admin/employee/advisor UI debounce

- Server ignores `contains` search until query length ≥ 3
- Applies to admin leads API + employee + advisor + case assessor (via shared filter)
- Admin UI shows amber hint when 1–2 chars typed

## Priority 4 — Dashboard in-memory cache

**Files:** `src/lib/admin-dashboard-cache.ts`, `src/app/api/admin/dashboard/route.ts`

- Full dashboard JSON cached **30 seconds** per date-range key
- Cache cleared on admin lead import, assign, delete
- Second dashboard load within 30s should log `cache hit`

## Not changed (Priority 5)

- `skip` / `take` pagination kept as-is
- AUTO SELECT, select-all `idsOnly` unchanged
- No Redis

---

See root `docs/ARCHITECTURE.md` for full system context.
