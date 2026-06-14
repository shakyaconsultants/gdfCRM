# GDF Internationals CRM — Full Technical Audit

**Date:** 2026-06-13
**Scope:** Whole repository — auth, API routes, database schema/queries, CRM flow, frontend data-fetching, server-load.
**Stack:** Next.js 16, React 19, Prisma 6, MongoDB (Atlas), deployed on Vercel.
**Author:** Senior fullstack engineer / PM review.

> **How to read this:** Each issue has a stable ID (e.g. `SEC-1`), a severity, the file + line, the impact, and a concrete fix. Nothing in this report has been changed in code — it is a plan. Suggested fixes are designed to be **non-breaking** unless explicitly marked otherwise.

---

## 1. Executive summary

The codebase is **well above average** for a freelance CRM. It already has thoughtful performance scaffolding: a dashboard snapshot cache, a short-TTL lead-count cache, batched name resolution (avoiding Prisma joins), per-lead save queue, visibility-aware polling, and sensible pagination on most list endpoints. Auth uses `jose` JWT with separate hub/CRM sessions and OTP.

The main risks are concentrated in three areas:

1. **Security hardening** — several auth flows "fail open" when `ADMIN_EMAIL` / OTP env is missing, an unauthenticated OTP-send endpoint, and in-memory rate limiting that is ineffective on Vercel's multi-instance runtime.
2. **Database read amplification at scale** — lead text search uses an **unindexed, case-sensitive regex** (`contains`), several endpoints fire **5 parallel `count()` scans** per request for stats, and **every bulk lead mutation rebuilds all dashboard snapshot scopes**. At ~20k leads/day these become your dominant server cost.
3. **CRM real-time sync edge cases** — the employee delta poll caps at 100 changes, so very large admin bulk-assignments can be under-reflected until a manual refresh.

None of these are on fire today, but they are the things that will bite as data grows. Below is the detail.

---

## 2. What is already good (keep / don't regress)

| Area | Why it's good | File |
|------|---------------|------|
| Dashboard snapshot cache | Pre-computes a 24+ query payload, serves stale-while-revalidate, coalesces concurrent cold builds | `src/lib/dashboard-stats-snapshot.ts` |
| Lead count micro-cache | 45s TTL avoids repeated slow `count()` on page flips | `src/lib/admin-leads-count-cache.ts` |
| Batched assignee names | Avoids Prisma relation joins on list views; validates ObjectIds first | `src/app/api/admin/leads/route.ts` (`attachAssigneeNames`) |
| Per-lead save queue | Serializes saves per lead so one debounce can't drop another lead's write | `src/lib/lead-save-queue.ts` |
| Visibility-aware polling | Pauses polling when tab hidden to cut idle server load | `src/hooks/useVisibilityPolling.ts` |
| Delta sync with skip-in-flight | Poll merges only newer rows and skips locally-pending edits | `src/lib/lead-sync-client.ts` |
| Split hub/CRM JWT sessions | CRM access gated by a second factor separate from hub login | `src/lib/enforce-employee-auth.ts`, `src/proxy.ts` |
| Login rate limiting | IP + per-email buckets on `/auth/login` | `src/app/api/auth/login/route.ts` |
| Search min-length guard | Rejects <3 char search to avoid trivial broad scans | `src/lib/lead-search-filter.ts` |
| Graceful query fallbacks | `findAdminLeadListRows` retries ordering strategies on failure | `src/app/api/admin/leads/route.ts` |
| Region pinning | `preferredRegion = 'bom1'` co-locates compute near users | multiple routes |

---

## 3. Severity legend

- 🔴 **Critical** — security hole or data-loss / correctness risk. Fix ASAP.
- 🟠 **High** — meaningful security, correctness, or scale risk.
- 🟡 **Medium** — performance or robustness; will hurt as data grows.
- 🔵 **Low** — polish, consistency, maintainability.

---

## 4. 🔴 Critical issues

### SEC-1 — Auth "fails open" when `ADMIN_EMAIL` is not set
**File:** `src/app/api/auth/login/route.ts:75-102`
When `ADMIN_EMAIL` is empty, `otpEnabled` becomes `false` and **all** roles log in with a full session and **employees are granted `crm: true` with no OTP**. The same env gap makes `employeeHasCrmAccess()` return `true` unconditionally (`src/lib/employee-jwt.ts`, used by `src/lib/enforce-employee-auth.ts` and `src/proxy.ts`).
**Impact:** A single missing/blank env var on the server silently disables OTP and the entire CRM second-factor for everyone.
**Fix (non-breaking):** Fail closed in production — if `NODE_ENV === 'production'` and `ADMIN_EMAIL`/OTP config is missing, return a 503 "server not configured" instead of issuing sessions. Gate any intentional bypass behind an explicit `DISABLE_LOGIN_OTP=true` flag so it can never happen by accident.

### SEC-2 — CRM OTP global-disable grants instant CRM session
**File:** `src/app/api/auth/employee-crm-otp/send/route.ts` (OTP-disabled branch)
When OTP is globally disabled, any already-authenticated employee is handed a CRM session cookie immediately.
**Impact:** CRM PII (phone, email, address of leads) becomes reachable without the intended second factor.
**Fix:** Only allow this bypass when `NODE_ENV !== 'production'`. In production require a verified OTP regardless.

### SEC-3 — Unauthenticated OTP-send endpoint (email-bomb / enumeration)
**File:** `src/app/api/auth/crm-access/send/route.ts`
The endpoint is callable with no authentication and only an **IP** rate limit; it triggers OTP emails for a supplied employee email.
**Impact:** Attacker can spam your admin/employee inbox and probe which emails exist. IP limit is trivially bypassed via rotating IPs (and is in-memory — see SEC-5).
**Fix:** Add a **per-email** rate limit, require an existing authenticated hub session before sending, and/or add a CAPTCHA. Bind the resulting OTP session to the requesting email (store an email hash and validate it on verify).

### SEC-4 — Employee DELETE has no role guard
**File:** `src/app/api/admin/employees/route.ts` (`DELETE`)
DELETE accepts an arbitrary `id` and deletes the user without confirming `role === 'EMPLOYEE'`.
**Impact:** An admin (or anything with the admin cookie) can delete **another admin/advisor/assessor**, and lead FK relations for advisor/assessor are not cleaned up (only `assignedToId`), risking orphaned references.
**Fix:** `findFirst({ where: { id, role: 'EMPLOYEE' } })` before delete; in a transaction, null out `assignedToId`, `assignedAdvisorId`, `assignedCaseAssessorId` for affected leads.

### PERF-1 — Unindexed, case-sensitive lead search (full collection scan)
**File:** `src/lib/lead-search-filter.ts:13-24`
```ts
OR: [
  { firstName: { contains: q } },   // no mode: 'insensitive'
  { lastName:  { contains: q } },
  { email:     { contains: q } },
  { phone:     { contains: q } },
]
```
Two problems:
1. **Correctness:** without `mode: 'insensitive'`, searching `john` will not match `John`.
2. **Performance:** Prisma compiles `contains` to an **unanchored `$regex`** on MongoDB, which **cannot use an index** → a full collection scan on every search. At millions of leads this is the single most expensive query in the app and will spike CPU/IO.
**Fix (non-breaking, staged):**
- Short term: add `mode: 'insensitive'` for correctness; keep the 3-char min guard.
- Medium term: for **phone** (the most common lookup) store a normalized phone and do **prefix/exact** match (anchored regex `^` can use an index) instead of `contains`. For names, add a **MongoDB Atlas Search text index** (or a lowercased `searchTokens` array field with a multikey index) and query that instead of 4 regex `OR`s.

---

## 5. 🟠 High issues

### SEC-5 — Rate limiting is in-memory (ineffective on Vercel)
**File:** `src/lib/rate-limit.ts`
Buckets live in a per-process `Map`. Vercel runs many isolated instances and recycles them, so the limit resets constantly and is not shared across instances.
**Impact:** Login / OTP brute-force protection is far weaker than it looks. Same applies to the in-memory OTP failure counters in `verify-otp` and `crm-access/verify`.
**Fix:** Move rate-limit + OTP attempt counters to a shared store (Upstash Redis / Vercel KV). Keep the in-memory version as a dev fallback.

### SEC-6 — Inconsistent JWT secret handling
**Files:** `src/app/api/admin/employees/route.ts`, `admin/attendance/route.ts`, `admin/leave-requests/route.ts`, `admin/employees/upload-photo/route.ts`
These build the secret inline with `new TextEncoder().encode(process.env.JWT_SECRET)` instead of the centralized `getJwtSecret()` (which validates presence).
**Impact:** If `JWT_SECRET` is missing these encode `undefined` and verification behaves inconsistently vs other routes.
**Fix:** Use `getJwtSecret()` everywhere.

### SEC-7 — Missing `try/catch` on several auth routes
**Files:** `auth/crm-access/send`, `auth/crm-access/verify`, `auth/employee-crm-otp/send`, `auth/employee-crm-otp/verify`, `employee/change-password`
Unhandled DB/mail exceptions become raw 500s and can leak stack context in some setups.
**Fix:** Wrap handlers in `try/catch` returning a consistent `{ error }` JSON, mirroring `auth/login`.

### SEC-8 — Password & upload input not bounded
**Files:** `employee/change-password/route.ts`, `admin/employees/route.ts`, `admin/upload`, `admin/employees/upload-photo`, `employee/profile-image`
- No **max** password length → very long inputs make bcrypt a CPU DoS vector.
- New-employee passwords hashed at **bcrypt cost 10**, change-password at **cost 12** → inconsistent.
- `profileImageUrl` stored from client JSON with no host validation → arbitrary URL injection.
- Uploads validate MIME from client `Content-Type` only (no magic-byte check) and have **no upload rate limit**.
**Fix:** Cap password length (e.g. 12–128); standardize bcrypt cost to 12; validate `profileImageUrl` against your Cloudinary host allowlist; validate file signatures and add a per-user upload rate limit.

### PERF-2 — Every bulk lead mutation rebuilds *all* dashboard scopes
**File:** `src/lib/dashboard-stats-snapshot.ts:134-147` (`refreshDashboardStatsAfterLeadMutation`)
On every assign / unassign / import / delete, this loads **all stored `DashboardStats` scopes** and rebuilds each one — and each rebuild is the **24+ query** `buildAdminDashboardPayload`. If admins have viewed many date ranges, a single "assign 5,000 leads" click can kick off dozens of full dashboard recomputations.
**Impact:** Write-path amplification; DB CPU spikes during the busiest operation (assignment).
**Fix:** (a) Only refresh `all` + the default rolling-30d scope on mutation; let other scopes refresh lazily on view via the existing stale-while-revalidate path. (b) Debounce/coalesce: if a refresh ran in the last N seconds, skip. (c) Consider marking snapshots dirty and rebuilding on next read instead of on every write.

### PERF-3 — Per-request 5× `count()` stat scans
**Files:** `src/lib/lead-assigned-stats.ts` (employee CRM `?stats=true`), `src/lib/admin-aggregations.ts` (dashboard), `advisor/leads` stats branch
Each call runs 5 separate `count()`/`groupBy()` scans. The employee CRM panel requests `stats=true` on **every** poll and full load.
**Impact:** Multiply by active employees polling every 2 min → continuous count load.
**Fix:** Compute the per-employee stats with a **single `groupBy` + in-memory reduction**, or cache the stats per employee for ~60s (similar to the count cache). For the CRM poll specifically, only recompute stats when the lead `total` actually changed.

### CRM-1 — Delta poll caps at 100 changes (large bulk assigns under-reflected)
**Files:** `src/app/api/employee/leads/route.ts` (`DELTA_TAKE = 100`), `src/components/employee/EmployeeCrmPanel.tsx`
The employee poll fetches at most 100 changed rows since last sync and merges them. After the recent change that removed the "full refresh when total changes", a bulk admin assignment of >100 leads will only surface the newest 100 until the employee manually reloads.
**Impact:** Employees may not see all newly-assigned leads promptly.
**Fix (balanced):** Keep the no-reshuffle behavior, but when the poll detects `total` increased by more than the number of merged deltas (or deltas hit the 100 cap), trigger **one** silent background full refresh of the current page — gated by the existing interaction-pause so it won't disrupt active copying.

### BUG-1 — Empty import batches created when all rows are duplicates
**File:** `src/app/api/admin/leads/route.ts:440-518`
`LeadImport` is created **before** dedup; if every row is a duplicate, you get a `LeadImport` row with 0 leads cluttering the import filter dropdown.
**Fix:** Create the `LeadImport` only when `newLeadsToInsert.length > 0`, or delete it if the final count is 0.

---

## 6. 🟡 Medium issues

| ID | File | Issue | Fix |
|----|------|-------|-----|
| PERF-4 | `prisma/schema.prisma` | No compound index matching the hottest admin query (`importId` + `disposition` + `assignedToId` for the unassigned pool). Existing indexes are single-purpose. | Add a compound index e.g. `@@index([importId, disposition, assignedToId])` to serve the "unassigned New in batch" filter. Validate with `explain`. |
| PERF-5 | `src/app/api/admin/employees/route.ts`, `employee/leaderboard`, `employee/monthly-stars` | `findMany` over **all** employees with no `take` on routes that only need top-N. | Add pagination or cap; cache leaderboard/monthly-stars (changes slowly). |
| PERF-6 | `src/app/api/admin/attendance/route.ts` | Hard `take: 800` with no pagination metadata → silent truncation. | Return real pagination (`total`, `page`) and an explicit cap. |
| PERF-7 | `src/app/api/admin/metrics/route.ts` | Appears to **duplicate** dashboard aggregation logic that `/api/admin/dashboard` already serves via snapshot cache. Possibly dead/legacy and uncached. | Confirm usage; delete if unused, or back it with the snapshot cache. |
| SEC-9 | `admin/leave-requests/route.ts`, `employee/leads/route.ts` | `status` / `disposition` query params passed to Prisma without allowlist validation. | Validate against known enums before querying. |
| SEC-10 | `auth/verify-otp`, `auth/crm-access/verify` | OTP brute-force counters are in-memory per instance (reset on cold start). | Persist attempt counts keyed by session in Redis/DB. |
| SEC-11 | `admin/upload/route.ts` | Returns the **full** Cloudinary `result` object to the client. | Return only `{ url, publicId }`. |
| BUG-2 | `src/app/api/admin/payroll/route.ts` | Verified-sale counting uses `updatedAt` range instead of the shared `verifiedInMonthFilter` (which prefers `verifiedAt`). Payroll incentives may miscount vs dashboard. | Reuse `verifiedInMonthFilter` from `src/lib/verified-month.ts` for consistency. |
| ROBUST-1 | several routes | Empty `catch {}` blocks swallow errors with no logging (`leave-requests`, `attendance`, `advisor/leads`, `employee/leads`). | `console.error` before returning 500 for observability. |
| DATA-1 | `src/lib/db.ts` | No explicit Prisma connection management for serverless; relies on global singleton (fine for Vercel, but no pool tuning). | Confirm MongoDB Atlas connection limits vs Vercel concurrency; set `connection_limit` in the Mongo URI if needed. |

---

## 7. 🔵 Low issues / polish

| ID | File | Issue | Fix |
|----|------|-------|-----|
| LOW-1 | `admin/employees/route.ts` | `employeeId` generated with `Math.random()`. | Use `crypto.randomBytes`/`randomInt`. |
| LOW-2 | `admin/payroll/route.ts` | `year` not bounded (e.g. `99999` still runs queries). | Clamp to a sane range. |
| LOW-3 | `employee/leaderboard/route.ts` | `Cache-Control: max-age=120` may show stale ranks mid-month. | Shorten TTL during business hours or `no-store`. |
| LOW-4 | `advisor/leads/[id]/documents/route.ts` | `formData.get('file') as File` without `instanceof Blob` check. | Validate type before use. |
| LOW-5 | `src/app/admin/page.tsx` | "Pipeline Velocity" panel is a hardcoded placeholder with fake bars. | Wire to real data or remove to avoid misleading users. |
| LOW-6 | `advisor/leads/[id]/documents/route.ts` | Document `findMany` has no `take`. | Cap (e.g. 50) + paginate. |
| LOW-7 | Repo | `audit`/dead code: confirm `/api/admin/metrics` and any unused libs are pruned. | Remove dead routes to reduce surface. |

---

## 8. Database & query optimization (deep dive)

**Current indexes** (`prisma/schema.prisma`, `Lead`):
`createdAt`, `importId+createdAt`, `assignedToId+createdAt`, `assignedAdvisorId+createdAt`, `assignedCaseAssessorId+createdAt`, `disposition+createdAt`, `updatedAt`, plus `phone @unique`.

**Recommendations:**

1. **Search (PERF-1):** Biggest win. Replace 4-field `contains` regex with:
   - Phone: normalized exact/prefix match (indexable).
   - Names/email: Atlas Search index, or a `searchTokens String[]` multikey index populated on write.
2. **Compound index for the unassigned pool (PERF-4):** the admin "AUTO SELECT / Unassigned (New)" path filters `importId` + `disposition = New` + `assignedToId is null`. Add `@@index([importId, disposition, assignedToId])`. Use MongoDB `explain()` to confirm index usage (Prisma `db push` creates them, but verify selectivity).
3. **`groupBy` on low-cardinality booleans** (`closedSale`, `verifiedSale`, `paymentReceived`): indexes help little; the real lever is the **dashboard snapshot cache** already in place — just stop over-refreshing it (PERF-2).
4. **Count amplification (PERF-3):** prefer one `groupBy` over N `count()` where the same `where` base is reused.
5. **Connection limits:** with Vercel concurrency + Mongo Atlas, set `?maxPoolSize=` appropriately in `DATABASE_URL` to avoid connection storms during bulk operations.

---

## 9. CRM flow review (product + engineering)

**Lead lifecycle:** Import → Unassigned pool (disposition `New`) → Admin assigns/transfers/unassigns → Employee works (disposition, intake, callback) → Refer to Advisor → Advisor → Case Assessor → Verified/Clawback. Dual-assignment model (employee + advisor + assessor concurrently) is sound.

**Observations & suggestions:**

- ✅ **Assignment resets employee work but preserves advisor/assessor data** (`src/lib/lead-assignment.ts`) — correct and intentional.
- ✅ **Unassigned normalization** keeps the assignable pool consistent (`normalizeUnassignedLeadDispositions`). Good, but it runs on the GET path when `unassignedOnly` — consider moving to the explicit `normalize-unassigned` route only, so normal listing isn't doing writes.
  - ⚠️ **Side effect on a read:** a `GET` that triggers `updateMany` is surprising and adds write load to a hot list endpoint. Prefer running normalization on assignment actions + the dedicated route, not on every unassigned listing.
- ⚠️ **CRM-1 (delta cap):** see High section — large bulk assigns need a reconciliation trigger.
- ⚠️ **Transfer logging granularity:** `LeadAssignmentBatch` records `previousEmployeeId` only when *uniform*; mixed-source assigns log as `ASSIGN` with null previous. That's a reasonable simplification, but the history can't fully reconstruct a mixed transfer. Document this limitation in the Assignments UI.
- 💡 **Copy-restriction UX:** `useRestrictCopy` blocks copy outside `.select-text`/form fields. Ensure every field employees legitimately need (phone, email, address, postcode, name) is marked `.select-text`, or they'll fight the guard. Currently phone/email/address are covered; verify name/postcode.
- 💡 **Idempotency on assign:** the assign `PUT` is not idempotent against double-clicks (no request key). The `updatedCount` guard mitigates, but a rapid double assign to two employees could split a batch. Consider disabling the button while in flight (frontend already does) + a server-side short dedupe.

---

## 10. Frontend / data-fetching review

- ✅ **Sequence guards** (`fetchSeqRef`, `countSeqRef`) correctly prevent out-of-order responses from clobbering state (`src/app/admin/leads/page.tsx`).
- ✅ **No fetch when no import batch selected** avoids accidental full-pool scans.
- ✅ **Employee panel** pauses polling during interaction and merges in place (recent fix) — good for the "list jumps while copying" problem.
- 🟡 **Stats on every poll** (CRM-related to PERF-3): `buildLeadsQuery` always sets `stats=true`. Only request stats on first load and when `total` changes.
- 🟡 **`any` typed metrics** in `src/app/admin/page.tsx` (`useState<any>`) lose type safety; tighten to the `AdminDashboardPayload` shape.
- 🔵 **Polling intervals** (120s CRM, 300s employee hub) are reasonable; once stats are cached you can keep them.

---

## 11. Server-load reduction — prioritized plan

**These five changes will cut the majority of avoidable DB load without changing behavior:**

1. **PERF-1** — Fix lead search (insensitive + indexed phone + Atlas Search for names). *Largest single win.*
2. **PERF-2** — Stop rebuilding all dashboard scopes on every mutation; refresh only `all` + rolling-30d, lazily revalidate the rest. Debounce.
3. **PERF-3** — Cache per-employee CRM stats (~60s) and only recompute on `total` change; collapse 5 counts into 1 `groupBy` on the dashboard.
4. **PERF-4** — Add the compound index for the unassigned-pool query; verify with `explain()`.
5. **Move normalization off the GET path** (CRM flow note) so listing leads doesn't issue writes.

---

## 12. Security — prioritized plan

1. **SEC-1 / SEC-2** — Fail closed in production when OTP/`ADMIN_EMAIL` is missing.
2. **SEC-3** — Lock down `crm-access/send` (auth + per-email limit + session binding).
3. **SEC-4** — Role-guard employee DELETE + transactional FK cleanup.
4. **SEC-5 / SEC-10** — Move rate limits + OTP counters to Redis/Vercel KV.
5. **SEC-6/7/8** — Centralize `getJwtSecret()`, add try/catch, bound passwords/uploads, standardize bcrypt cost, validate image URLs.

---

## 13. Quick wins (low effort, safe, do this week)

- Add `mode: 'insensitive'` to lead search (correctness) — `src/lib/lead-search-filter.ts`.
- Only create `LeadImport` when leads were actually inserted — BUG-1.
- Add allowlist validation for `status`/`disposition` query params — SEC-9.
- Replace empty `catch {}` with `console.error(...)` — ROBUST-1.
- Standardize bcrypt cost to 12 and use `getJwtSecret()` everywhere — SEC-6/8.
- Trim `/api/admin/upload` response to `{ url, publicId }` — SEC-11.
- Remove or wire up the fake "Pipeline Velocity" panel — LOW-5.

---

## 14. Suggested order of execution (non-breaking first)

| Phase | Items | Risk | Note |
|-------|-------|------|------|
| 1 (safe, immediate) | Quick wins §13, SEC-6/7, ROBUST-1, BUG-1/2 | Very low | Pure hardening + consistency |
| 2 (perf, staged) | PERF-2, PERF-3, PERF-4, move normalization off GET | Low–medium | Measure with query timing logs before/after |
| 3 (search rework) | PERF-1 (insensitive → indexed → Atlas Search) | Medium | Roll out phone-exact first, then names |
| 4 (security infra) | SEC-1/2/3/4, SEC-5/10 (Redis) | Medium | Needs Redis/KV provisioning + env policy |
| 5 (CRM polish) | CRM-1 reconciliation, idempotency, UI notes | Low | Improves operator trust |

---

### Appendix: files reviewed
Core infra (`db.ts`, `proxy.ts`, `rate-limit.ts`, `jwt-secret.ts`, `enforce-employee-auth.ts`), all of `src/app/api/**` (51 routes; 21 deep-read), dashboard/aggregation libs (`build-admin-dashboard-payload.ts`, `dashboard-stats-snapshot.ts`, `admin-aggregations.ts`, `lead-assigned-stats.ts`, `verified-month.ts`), lead libs (`lead-assignment*.ts`, `lead-search-filter.ts`, `lead-sync-client.ts`, `lead-save-queue.ts`, count cache), schema (`prisma/schema.prisma`), and the main frontends (`admin/leads/page.tsx`, `admin/page.tsx`, `components/employee/EmployeeCrmPanel.tsx`, hooks).

> **Note:** Several security findings depend on production env configuration (`ADMIN_EMAIL`, OTP flags, `JWT_SECRET`). Verify the actual Vercel env before assuming a flow is exposed — the code paths exist, but may be disabled by correct env. The fixes above make the safe behavior the *default* rather than env-dependent.

---

## 15. Implementation status (2026-06-14)

All items below were implemented in a **non-breaking** way; existing behavior is preserved.

### Implemented in code
| ID | What changed |
|----|--------------|
| SEC-1 | `isOtpBypassAllowed()` (`src/lib/otp-config.ts`); login fails closed in production when `ADMIN_EMAIL` missing unless `DISABLE_LOGIN_OTP=true`. `employeeHasCrmAccess` no longer unlocks CRM via env gap. |
| SEC-2 | `employee-crm-otp/send` only auto-issues a CRM session without OTP when bypass is allowed; otherwise 503. |
| SEC-3 | `crm-access/send` now has a **per-email** rate limit + `try/catch`. |
| SEC-4 | Employee `DELETE` role-guards `role: 'EMPLOYEE'` and nulls `assignedToId`/`assignedAdvisorId`/`assignedCaseAssessorId` in one transaction. |
| SEC-5 | `rate-limit.ts` is now async with an **Upstash Redis REST** backend (env-gated `UPSTASH_REDIS_REST_URL`/`_TOKEN`) and in-memory fallback. All auth routes `await` it. |
| SEC-6 | `getJwtSecret()` used in `admin/employees`, `attendance`, `leave-requests`, `upload-photo`. |
| SEC-7 | `try/catch` added to all CRM/OTP auth routes + `change-password`. |
| SEC-8 | Centralized `password-policy.ts` (bcrypt cost **12**, 8–128 length, Cloudinary URL allowlist); magic-byte image sniffing + per-user upload rate limits on all upload routes. |
| SEC-9 | Allowlist validation for `status` (leave-requests) and `disposition` (employee/leads). |
| SEC-10 | OTP attempt counters persisted in DB (`LoginOtpSession.attempts`) instead of in-memory maps. |
| SEC-11 | `admin/upload` returns only `{ secure_url, public_id }`. |
| PERF-1 | Lead search is now case-insensitive; numeric/phone queries get an anchored prefix term (index-friendly) alongside the `contains` fallback. |
| PERF-2 | `refreshDashboardStatsAfterLeadMutation` refreshes only `all` + rolling-30d, debounced 30s; other scopes revalidate lazily on read. |
| PERF-3 | Per-user assigned-stats cached 60s (`countAssignedLeadStatsCached`) for employee + advisor CRM. |
| PERF-4 | Compound index `@@index([importId, disposition, assignedToId])` added. |
| PERF-6 | `attendance` returns `total`/`cap`/`truncated` (cap raised to 2000). |
| PERF-7 / LOW-7 | Dead `/api/admin/metrics` route deleted. |
| BUG-1 | Empty `LeadImport` deleted when every row was a duplicate; response `importId` is null. |
| BUG-2 | Payroll verified counting uses `verifiedInMonthFilter`. |
| ROBUST-1 | `console.error` added to previously-silent catches (leave-requests, attendance, advisor/leads, case-assessor/leads, employee/leads, admin/employees GET). |
| CRM-1 | Employee poll triggers one silent full refresh when total grows beyond the 100-row delta cap (gated by interaction pause). |
| CRM flow | Unassigned normalization removed from the hot GET listing path; runs only via explicit repair + the unassign action + dedicated route. |
| Idempotency | Short server-side dedupe on assign/unassign `PUT`. |
| LOW-1 | `employeeId` via `crypto.randomBytes`. |
| LOW-2 | Payroll `year` clamped to `[2000, currentYear+1]`. |
| LOW-3 | Leaderboard cache TTL shortened to 60s. |
| LOW-4 | Advisor document upload validates `instanceof Blob`. |
| LOW-5 | Fake "Pipeline Velocity" panel removed. |
| LOW-6 | Advisor documents `findMany` capped at 50. |
| Frontend | Admin dashboard `metrics` typed (no more `any`); employee table name/postcode marked `.select-text`. |

### Requires an operator action (no safe code-only fix)
- **PERF-4 index / SEC-10 field:** run `npx prisma db push` so MongoDB creates the new compound index and `attempts` field.
- **SEC-5 / SEC-10 (distributed):** set `UPSTASH_REDIS_REST_URL` + `UPSTASH_REDIS_REST_TOKEN` in the environment to activate cross-instance rate limiting (in-memory fallback works without it).
- **SEC-1 / SEC-2 prod posture:** ensure `ADMIN_EMAIL` (+ SMTP) is set in production; otherwise set `DISABLE_LOGIN_OTP=true` to intentionally bypass.
- **PERF-1 (deep):** Atlas Search / `searchTokens` multikey field for name search was **deferred** — it needs an Atlas index definition + a full backfill window and would change phone-substring matching. The shipped insensitive + anchored-phone change is the safe subset.
- **DATA-1:** tune `maxPoolSize` in `DATABASE_URL` for Vercel concurrency vs Atlas limits.
- **PERF-5:** leaderboard/monthly-stars already cached; employee-list queries are bounded by the (small) employee count — left as-is to keep ranking correct.
