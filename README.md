# 🚀 GDF Internationals / Bee CRM

## 📌 Overview

**GDF Internationals / Bee CRM** (formerly *Nexus CRM Enterprise v2.0*) is a production-grade, multi-role telemarketing CRM and case management suite. Built on **Next.js 16**, **React 19**, **Prisma 6**, and **MongoDB**, it is architected to support high-velocity sales floors with concurrent dialers while maintaining strict compliance checks, attendance reviews, commission payroll calculations, and executive oversight.

### The Problem It Solves
High-volume telemarketing floors suffer from operational bottlenecks:
* **Server Overhead**: Traditional systems query full tables and run heavy aggregate operations (e.g., calculations on ~40,000+ growing lead pools) on every dashboard load, pegging server CPUs.
* **Shared Hosting Limitations**: Running applications on shared hosting (such as cPanel) imposes rigid constraints on memory heaps (~768MB cap) and thread pools.
* **Disposition Write Conflicts**: Concurrent edits from multiple agents updating remarks or dispositions often cause last-write-wins collisions or state overwrites.
* **Background Request Storms**: Browser tabs left open in the background run polling loops, generating unnecessary database queries.

### Key Highlights
* **MongoDB L2 Snapshotting (`DashboardStats`)**: Replaces 24+ heavy database aggregation queries with a single document read, dropping dashboard response times from ~5.5s to **100–300ms**.
* **Delta-Based Syncing**: Client boards request changes since their last sync (`?since=`), minimizing network payloads.
* **Per-Lead Serial Save Queue**: Client-side serial debounce maps patches to specific lead IDs, protecting in-flight edits.
* **Visibility-Aware Polling**: Background tabs pause polling loops using the HTML5 Page Visibility API to save server resources.
* **Offset Pagination Guard**: Enforces pagination limits (50/page) on lists, fetching an extra record (51) to determine the next page without executing expensive counts.
* **cPanel Standalone Optimization**: Includes environment loaders and thread constraints to run efficiently under strict shared hosting resource caps.

---

## 🧱 Tech Stack

| Category | Technology | Description |
| :--- | :--- | :--- |
| **Frontend Framework** | React 19.2.4 | Interactive UI layer using client components and custom hook wrappers. |
| **Routing & Backend** | Next.js 16.2.6 (App Router) | Handles SSR, routing, and REST API endpoints. |
| **Styling Engine** | Tailwind CSS v4 & PostCSS | Compiled styling with custom CSS variables and glassmorphic layouts. |
| **Animations** | Framer Motion | Smooth state transitions and modal overlay scales. |
| **Database & ORM** | Prisma 6.19.3 & MongoDB | Prisma ORM mapping schemas to MongoDB databases. |
| **Icons** | Lucide React | Standardized telemetry iconography. |
| **Authentication** | `jose` (v6.2.2) | Edge-compatible JWT verification. |
| **Encryption** | `bcryptjs` (v3.0.3) | Salts and hashes passwords securely. |
| **Cloud Storage** | Cloudinary SDK | Cloud storage for uploaded lead documents and verification files. |
| **Emails & OTPs** | Nodemailer | Distributes login OTPs and onboarding emails. |
| **File Parsing** | `papaparse` & `read-excel-file` | Lazy-loaded client modules parsing CSV/Excel lead files. |

---

## 🏗️ Architecture

Bee CRM employs a **Layered Monolithic Architecture** optimized for resource-restricted hosting environments. 

```
                                 +---------------------------------------------+
                                 |                 Web Browser                 |
                                 |     (React 19, Context State, Tailwind v4)  |
                                 +----------------------+----------------------+
                                                        |
                                                        | HTTP REST API (JSON)
                                                        v
+-------------------------------------------------------+----------------------+
|                           Next.js API Gateway Layer                          |
|             (Page Redirection /src/proxy.ts | API routes /api/*)             |
+-------------------------------------------------------+----------------------+
                                                        |
                                                        | Domain Services
                                                        v
+-------------------------------------------------------+----------------------+
|                     Domain & Utility Services (src/lib/)                     |
|  (dashboard-stats-snapshot.ts | lead-save-queue.ts | payroll-utils.ts)       |
+--------------------+----------------------------------+----------------------+
                     |                                  |
                     | Prisma ORM                       | Nodemailer / Cloudinary
                     v                                  v
             +-------+------+                   +-------+-------+
             | MongoDB Atlas|                   | Third-Party   |
             |  (Mumbai)    |                   | Integrations  |
             +--------------+                   +---------------+
```

### Architectural Design Decisions

1. **Proxy Gating (`/src/proxy.ts`)**: Custom middleware configured with Next.js edge matchers. It intercepts page navigations to inspect JWT payloads, separating unauthorized users before rendering client bundles.
2. **Snapshot-Driven Dashboards**: The system avoids recalculating metrics on every dashboard load. Instead, it reads precomputed snapshots from `DashboardStats` using a **Stale-While-Revalidate (SWR)** strategy.
3. **Slim List Projections**: Large fields (such as compliance checklists and intake forms) are excluded from listing views. Full payloads are requested only when a lead row is expanded.
4. **Environment Resource Caps**: The custom production server (`server.js`) configures `UV_THREADPOOL_SIZE=4` and `--max-old-space-size=768` to prevent process restarts on shared hosting.

---

## 📂 Project Structure

```
/root
 ├── docs/
 │    ├── ARCHITECTURE.md                 # System guides, scaling bottlenecks, and reviews
 │    ├── PERFORMANCE-OVERVIEW.md         # Optimization summary (before vs. after metrics)
 │    └── PERFORMANCE-IMPLEMENTATION.md   # Chronological implementation logs (indexes, timing)
 ├── prisma/
 │    └── schema.prisma                   # Core Prisma schemas and database models
 ├── scripts/
 │    └── prepare-standalone.mjs          # Standalone builder copying static and Prisma assets
 ├── src/
 │    ├── app/                            # Next.js App Router folders
 │    │    ├── (player)/                  # Legacy profile layout routes
 │    │    │    ├── my-profile/
 │    │    │    └── layout.tsx
 │    │    ├── (staff)/                   # CRM interfaces grouped by user role
 │    │    │    ├── active-sessions/      # Legacy components
 │    │    │    ├── create-bill/
 │    │    │    ├── customers/
 │    │    │    ├── dashboard/
 │    │    │    └── layout.tsx
 │    │    ├── admin/                     # Admin modules
 │    │    │    ├── advisors/             # Advisor CRUD settings
 │    │    │    ├── attendance-review/    # Supervisor clock logs
 │    │    │    ├── case-assessors/       # Case assessor management
 │    │    │    ├── cases/                # Cases dashboard
 │    │    │    ├── employees/            # Employee CRUD tools
 │    │    │    ├── leads/                # Lead uploads, allocations, and search
 │    │    │    ├── leave-requests/       # Employee leave approvals
 │    │    │    ├── payroll/              # Monthly gross/incentive processor
 │    │    │    └── page.tsx              # Snapshot-driven admin dashboard
 │    │    ├── employee/                  # Employee workspace folders
 │    │    │    ├── attendance/           # Clock-in/out console
 │    │    │    ├── crm/                  # Telemarketing workspace
 │    │    │    ├── leaves/               # Request leaves
 │    │    │    ├── settings/             # Profile credentials
 │    │    │    └── page.tsx              # Employee hub
 │    │    ├── advisor/                   # Advisor closer layout
 │    │    ├── case-assessor/             # Compliance checker portal
 │    │    ├── login/                     # OTP credentials verification
 │    │    ├── api/                       # REST API route handlers
 │    │    ├── globals.css                # Base stylesheet
 │    │    └── layout.tsx                 # Base HTML wrapper
 │    ├── components/                     # Reusable UI component modules
 │    │    └── Navigation.tsx             # JWT-state aware navigation bar
 │    ├── hooks/
 │    │    └── useVisibilityPolling.ts    # Visibility-aware polling loop
 │    ├── lib/                            # Business logic utilities
 │    │    ├── admin-aggregations.ts      # Dashboard metric query calculations
 │    │    ├── admin-dashboard-cache.ts   # L1 cache configuration
 │    │    ├── admin-leads-count-cache.ts # In-memory pagination count cache
 │    │    ├── adminDateRange.ts          # Cache key converters
 │    │    ├── build-admin-dashboard-payload.ts # Raw query builder (cold cache)
 │    │    ├── dashboard-stats-snapshot.ts# Mongo L2 snapshot controller
 │    │    ├── enforce-employee-auth.ts   # Route security checks
 │    │    ├── lead-list-selects.ts       # Database projection select parameters
 │    │    ├── lead-save-queue.ts         # Client debounce queue
 │    │    ├── lead-sync-client.ts        # Client delta merger
 │    │    └── query-timing-log.ts        # cPanel performance logger
 │    └── proxy.ts                        # Edge-runtime security controller
 ├── server.js                            # cPanel standalone runner
 ├── tsconfig.json                        # TypeScript settings
 ├── next.config.ts                       # Next standalone definitions
 └── package.json                         # Dependencies configuration
```

### Folder and File Interactions

* **`src/proxy.ts` (Proxy Middleware)**: Intercepts all incoming requests. If the request matches protected paths (e.g., `/admin/*`, `/employee/*`), it verifies the user's role and redirects unauthorized requests to `/login`.
* **`prisma/schema.prisma`**: The schema definitions file. Generated client schemas are used by routes in `src/app/api/` to query databases, and by aggregation scripts in `src/lib/` to perform calculations.
* **`src/lib/dashboard-stats-snapshot.ts`**: Coordinates between the database and the dashboard UI. It attempts to read cached data from `DashboardStats`, falls back to `src/lib/build-admin-dashboard-payload.ts` if missing, and schedules background updates.
* **`src/lib/lead-save-queue.ts`**: Enqueued updates are sent to `/api/employee/leads/[id]` (or `/api/admin/leads/[id]`) after a brief debounce period, reducing redundant database writes during active calling sessions.

---

## 🔄 Application Workflow

```
[Import Phase]                     [Allocation Phase]                  [Calling Phase (Agent)]
 
+------------------+             +-----------------------+            +-----------------------+
| Admin uploads    |             | Admin assigns QTY     |            | Agent views CRM board |
| CSV leads file   |             | using AUTO SELECT     |            | (/employee/crm)       |
+--------+---------+             +-----------+-----------+            +-----------+-----------+
         |                                   |                                    |
         v                                   v                                    v
+------------------+             +-----------------------+            +-----------------------+
| Phone duplicates |             | Allocates unassigned  |            | Updates disposition   |
| filtered in bulk |             | leads to Agent        |            | & logs call notes     |
+--------+---------+             +-----------+-----------+            +-----------+-----------+
         |                                   |                                    |
         v                                   |                                    v
+------------------+                         |                        +-----------------------+
| DB insert using  |                         |                        | Change triggers       |
| createMany       |                         |                        | local debounce queue  |
+------------------+                         |                        +-----------+-----------+
                                             |                                    |
                                             v                                    v
                                 +-----------+-----------+            +-----------------------+
                                 | Delta polling syncs   |            | Save writes remarks   |
                                 | Agent board with DB   |            | to DB; sets callback  |
                                 +-----------------------+            +-----------+-----------+
                                                                                  |
                                                                                  v
                                                                      +-----------------------+
                                                                      | If Qualified: sets    |
                                                                      | moveToAdvisor = true  |
                                                                      +-----------------------+
                                                                                  |
                                                                                  v
                                                                      [Advisor Integration]
```

### workflow step trace

1. **Ingesting Leads**: The administrator uploads a CSV/Excel file on `/admin/leads`. The route handler `/api/admin/leads` parses phone numbers, runs a single query to find duplicates, filters them in memory, and performs a bulk insert.
2. **Assigning Leads**: The administrator selects unassigned leads (or uses the AUTO SELECT feature to select a set quantity) and allocates them to an employee.
3. **Contacting Leads**: The employee opens `/employee/crm`. The system loads the dashboard, while the `useVisibilityPolling` hook checks for delta updates in the background. The employee dials the customer, updates the status, and saves notes via the `LeadSaveQueue` helper.
4. **Escalating Cases**: For qualified leads, the employee opens the intake form, enters financial details (debts, monthly expenses), sets `moveToAdvisor` to `true`, and assigns an advisor.
5. **Verifying Cases**: The advisor reviews the files on `/advisor`, uploads proof documents to Cloudinary, and updates `caseStatus` to `PENDING` or `REFERRED`.
6. **Auditing Cases**: The case assessor validates the files on `/case-assessor` and updates the compliance checklist. If correct, the assessor marks it `VERIFIED`; otherwise, it is flagged as `CLAWBACK`.
7. **Processing Payroll**: The administrator opens `/admin/payroll`, calculates commissions based on verified cases, and views performance data.

---

## ⚙️ Core Features & Functionalities

### 🛡️ Authentication & Access Gating
* **Multi-Tier OTP Gating**: Features password verification alongside an email-based OTP verification step for administrators and advisors.
* **Employee CRM Gating**: Telemarketers use a two-step authentication lock (CRM OTP verify) to access leads, preventing data leakages.
* **Role Verification Middleware**: Page-level gates evaluate JWT parameters before loading route bundles.

### 📞 Leads Ingestion & Allocation
* **Bulk Ingestion Deduplication**: Filters CSV files against existing records in a single operation, preventing duplicate entries.
* **Auto-Selection**: Queries unassigned leads based on quantity limits for fast allocation, avoiding table lock issues.

### ⏱️ Real-Time CRM Activity Tracker
* **Tab-Visibility Polling**: Temporarily pauses database request loops if a user navigates away from the window tab.
* **Delta Synchronization**: Requests only changed records (`?since=timestamp`) to save bandwidth.

### 📋 Compliance Checklists & Cloudinary Attachments
* **Compliance Checks**: Case assessors use interactive checklists to track verification steps (living status, debt levels, income proofs).
* **Cloudinary Document Uploads**: Client documents are uploaded using secure backend signatures, shielding credentials from the browser inspector.

### 💸 Commission Payroll Processor
* **Base Salary + Incentives Calculations**: Automatically aggregates base salaries and commissions from verified sales.
* **Leaderboards**: Displays performance metrics and logs top converters on the dashboard.

---

## 🔌 API Documentation

### 🔑 Authentication Endpoints

#### `POST /api/auth/login`
* **Purpose**: Authenticates credentials and starts the OTP flow.
* **Request Payload**:
  ```json
  {
    "email": "employee@company.com",
    "password": "my-password"
  }
  ```
* **Success Response (200 OK)**:
  ```json
  {
    "success": true,
    "role": "EMPLOYEE",
    "requiresOtp": false
  }
  ```

#### `POST /api/auth/verify-otp`
* **Purpose**: Verifies login OTP codes and sets JWT tokens.
* **Request Payload**:
  ```json
  {
    "email": "admin@company.com",
    "code": "123456"
  }
  ```
* **Success Response (200 OK)**: Sets an HTTP-only cookie `token` containing credentials.

---

### 📂 Administrative Endpoints

#### `GET /api/admin/leads`
* **Purpose**: Fetches paginated lists, lists of matching IDs, or counts.
* **Parameters**:
  * `page` (optional): Defaults to `1`.
  * `search` (optional): Minimum 3 characters.
  * `disposition` (optional): Filter parameters.
  * `countOnly` (optional): If `true`, returns total count data.
  * `idsOnly` (optional): If `true`, returns matching ID arrays.
* **Response (200 OK - `countOnly=true`)**:
  ```json
  {
    "total": 41250,
    "totalPages": 825
  }
  ```

#### `POST /api/admin/leads`
* **Purpose**: Ingests array lists of new leads.
* **Request Payload**:
  ```json
  {
    "leads": [
      { "firstName": "Alice", "lastName": "Smith", "phone": "07123456789", "email": "alice@mail.com" }
    ]
  }
  ```
* **Success Response (200 OK)**:
  ```json
  {
    "success": true,
    "createdCount": 1,
    "skippedCount": 0
  }
  ```

#### `PUT /api/admin/leads`
* **Purpose**: Assigns selected lead IDs to an agent.
* **Request Payload**:
  ```json
  {
    "leadIds": ["lead-id-1", "lead-id-2"],
    "assignedToId": "employee-user-id"
  }
  ```
* **Success Response (200 OK)**:
  ```json
  {
    "success": true,
    "updatedCount": 2,
    "assignedToName": "John Doe"
  }
  ```

#### `GET /api/admin/dashboard`
* **Purpose**: Serves dashboard performance data using L2 snapshot files.
* **Response (200 OK)**: Returns the precomputed metrics JSON payload.

---

### 📞 Telemarketer / Employee Endpoints

#### `GET /api/employee/leads`
* **Purpose**: Fetches assigned leads for CRM boards.
* **Parameters**:
  * `page`: Page index.
  * `since`: ISO timestamp. Returns delta updates since this date.
* **Response (200 OK - Delta Sync Mode)**:
  ```json
  {
    "leads": [
      { "id": "lead-id-1", "disposition": "Callback", "updatedAt": "2026-05-30T08:00:00.000Z" }
    ],
    "serverTime": "2026-05-30T08:20:00.000Z"
  }
  ```

#### `PATCH /api/employee/leads/[id]`
* **Purpose**: Updates lead statuses and intake notes.
* **Request Payload**:
  ```json
  {
    "disposition": "Callback",
    "remarks": "Wants to talk tomorrow at 3 PM",
    "callbackAt": "2026-05-31T09:30:00.000Z"
  }
  ```

---

## 🧠 Key Logic Breakdown

### 1. SWR Snapshot Caching Logic
To prevent heavy query runs, `/api/admin/dashboard` uses the following caching logic:

```typescript
export async function getDashboardFromSnapshot(scopeKey: string, range: { gte: Date; lte: Date } | null) {
  ensureDashboardSnapshotScheduler();

  // Read snapshot from DB
  const snapshot = await readDashboardSnapshot(scopeKey);

  if (snapshot) {
    // If cache is younger than 5 min, serve immediately
    if (snapshot.ageMs < DASHBOARD_SNAPSHOT_TTL_MS) {
      return { payload: snapshot.payload, source: 'snapshot' };
    }

    // If cache is stale, trigger background update and serve stale immediately (SWR)
    void refreshDashboardSnapshot(db, scopeKey, range, { background: true }).catch(console.error);
    return { payload: snapshot.payload, source: 'snapshot-stale' };
  }

  // Cold build fallback
  const payload = await getOrStartColdBuild(scopeKey, range);
  return { payload, source: 'cold-build' };
}
```

### 2. CSV Bulk Import Deduplication
To optimize CSV uploads, the system filters out duplicates in memory before inserting records:

```typescript
// 1. Gather all phone numbers from the upload batch
const phoneNumbers = validLeads.map(l => parseLeadPhoneForStorage(l.phone));

// 2. Fetch existing records in one query
const existingLeads = await db.lead.findMany({
  where: { phone: { in: phoneNumbers } },
  select: { phone: true }
});
const existingPhonesSet = new Set(existingLeads.map(l => l.phone));

// 3. Filter and insert only new records
const newLeadsToInsert = validLeads.filter(l => !existingPhonesSet.has(l.phone));
await db.lead.createMany({ data: newLeadsToInsert });
```

### 3. Client Delta Merging
When the client receives updates from delta polling, it merges changes while preserving unsaved local state:

```typescript
export function mergeLeadDeltas(localRows: Lead[], deltas: Lead[], pendingIds: Set<string>): Lead[] {
  const deltaMap = new Map(deltas.map(d => [d.id, d]));
  
  return localRows.map(row => {
    // Skip updates if the row has a pending save
    if (pendingIds.has(row.id)) return row; 
    
    const delta = deltaMap.get(row.id);
    if (!delta) return row;
    
    // Merge only if the update is newer
    return new Date(delta.updatedAt) > new Date(row.updatedAt) ? delta : row;
  });
}
```

---

## 🗄️ Database Design

The database uses MongoDB schemas managed through Prisma.

### Collections Structure

#### 1. `User`
```prisma
model User {
  id                   String            @id @default(auto()) @map("_id") @db.ObjectId
  name                 String
  email                String            @unique
  password             String
  employeeId           String?           @unique
  profileImageUrl      String?
  baseSalaryMonthly    Float?
  role                 String            @default("EMPLOYEE")
  leadsAsEmployee      Lead[]            @relation("EmployeeLeads")
  leadsAsAdvisor       Lead[]            @relation("AdvisorLeads")
  leadsAsCaseAssessor  Lead[]            @relation("CaseAssessorLeads")
  leaveRequests        LeaveRequest[]
  attendanceEntries    AttendanceEntry[]
  createdAt            DateTime          @default(now())
  updatedAt            DateTime          @updatedAt
}
```

#### 2. `Lead`
```prisma
model Lead {
  id                     String         @id @default(auto()) @map("_id") @db.ObjectId
  title                  String?
  firstName              String?
  lastName               String?
  email                  String?
  addressLine1           String?
  addressLine2           String?
  addressLine3           String?
  addressLine4           String?
  postCode               String?
  phone                  String         @unique
  assignedToId           String?        @db.ObjectId
  assignedTo             User?          @relation("EmployeeLeads", fields: [assignedToId], references: [id])
  assignedAdvisorId      String?        @db.ObjectId
  assignedAdvisor        User?          @relation("AdvisorLeads", fields: [assignedAdvisorId], references: [id])
  assignedCaseAssessorId String?        @db.ObjectId
  assignedCaseAssessor   User?          @relation("CaseAssessorLeads", fields: [assignedCaseAssessorId], references: [id])
  assignedDate           DateTime?
  disposition            String         @default("New")
  caseStatus             String         @default("REFERRED")
  callbackAt             DateTime?
  preSipAt               DateTime?
  caseChecklist          Json?
  remarks                String?
  employeeIntakeForm     Json?
  moveToAdvisor          Boolean        @default(false)
  closedSale             Boolean        @default(false)
  verifiedSale           Boolean        @default(false)
  verifiedAt             DateTime?
  paymentReceived        Boolean        @default(false)
  createdAt              DateTime       @default(now())
  updatedAt              DateTime       @updatedAt
  documents              LeadDocument[]
}
```

#### 3. `DashboardStats`
```prisma
model DashboardStats {
  id        String   @id @default(auto()) @map("_id") @db.ObjectId
  scopeKey  String   @unique // Format: "all" or "YYYY-MM-DD__YYYY-MM-DD"
  payload   Json     // Precomputed JSON data
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
}
```

### Optimized Database Indexes
Indexes are configured to speed up queries at scale:
* `@@index([createdAt(sort: Desc)])`: Speeds up sorted dashboard lists.
* `@@index([assignedToId, createdAt(sort: Desc)])`: Optimizes agent CRM board loading.
* `@@index([disposition, createdAt(sort: Desc)])`: Accelerates admin pipeline filtering.
* `@@index([updatedAt(sort: Desc)])`: Speeds up delta polling queries.

---

## 🔐 Security Measures

* **Edge Gating Checks**: Edge-runtime gates verify credentials before compiling files.
* **HTTP-Only Cookies**: Tokens are saved in secure cookies (`httpOnly: true`, `sameSite: lax`), preventing XSS extraction.
* **Cloudinary Signing**: Signatures are generated server-side in `src/lib/cloudinary.ts` to prevent exposing API keys in the client browser.
* **OTP Session Expirations**: OTP sessions are tracked with absolute expiration limits in the database.
* **Search Guarding**: API searches require a minimum of 3 characters to prevent expensive full-table database scans.

---

## 🚀 Setup & Installation

Follow these steps to set up the development environment:

### 1. Prerequisites
* Install **Node.js (v18+)**
* Set up a **MongoDB database** (local instance or MongoDB Atlas cluster)

### 2. Install Packages
```bash
git clone https://github.com/gdf-internationals/bee-crm.git
cd bee-crm
npm install
```

### 3. Configure Variables
Create a `.env` file in the root directory:
```ini
DATABASE_URL="mongodb+srv://<user>:<password>@cluster.mongodb.net/beecrm?retryWrites=true&w=majority"
JWT_SECRET="generate-a-secure-random-key-here"

# Admin OTP Settings (Optional)
ADMIN_EMAIL="admin@company.com"

# SMTP Email Settings (Required if OTP is enabled)
SMTP_HOST="smtp.mailtrap.io"
SMTP_PORT=2525
SMTP_USER="smtp-username"
SMTP_PASS="smtp-password"

# Cloudinary Storage Settings (Required for uploads)
CLOUDINARY_CLOUD_NAME="cloud-name"
CLOUDINARY_API_KEY="api-key"
CLOUDINARY_API_SECRET="api-secret"
```

### 4. Initialize Database Schemas
```bash
# Generate Prisma clients
npx prisma generate

# Apply schemas and create indexes
npx prisma db push
```

### 5. Running the Application

#### Development Mode:
```bash
npm run dev
```

#### Production Mode:
```bash
npm run build
npm start
```

---

## 📸 UI/UX Design System

The CRM uses a modern dark aesthetic built with Tailwind CSS:
* **Layout Design**: Glassmorphic widgets using `neutral-900/50` backgrounds with `backdrop-blur-md` and thin borders.
* **Navigation States**: Tab bars are dynamically managed using `sessionStorage` to avoid unnecessary profile requests.
* **Action Forms**: Uses inline forms with micro-animations and loading indicators for a smooth user experience.

---

## 📈 Possible Improvements

1. **Cursor-Based Pagination**: Transitioning the admin panel pagination from offset (`skip`) to cursor-based keys will prevent performance degradation at higher scales (e.g. 100k+ records).
2. **Distributed Cache Integration (Redis/Upstash)**: Replacing in-process caches with Redis will allow caching across multi-instance serverless deployments.
3. **Zod Validation Middleware**: Implementing schema validators (such as Zod) will simplify request verification in API routes.
4. **Atlas Search**: Switching text search fields to MongoDB Atlas Search indexes will optimize text search performance.
5. **Database Transactions**: Wrapping critical workflow edits in database transactions will ensure data consistency across collections.

---

## 📚 Conclusion

GDF Internationals / Bee CRM is a well-optimized system built to handle high-concurrency environments. By utilizing database index optimizations, delta-based sync polling, debounced client queues, and dashboard snapshot caching, the application maintains fast response times and stable performance even when deployed on resource-constrained shared hosting environments.

---

## 💡 BONUS

### ASCII System Architecture

```
[Agent]                       [Supervisor]                     [Executive Dashboard]
   |                               |                                    |
   | (Dispositions)                | (Assessments)                      | (Performance Metrics)
   v                               v                                    v
+------------------+       +------------------+                 +------------------------+
| Client-Side      |       | Client-Side      |                 | Serving snapshot from  |
| Debounce Queue   |       | Checklists       |                 | DashboardStats L2      |
+--------+---------+       +--------+---------+                 +-----------+------------+
         |                          |                                       ^
         | PATCH                    | PATCH                                 | 5 min refresh
         v                          v                                       |
+---------------------------------------------+                 +-----------+------------+
|             Next.js REST API Gateway        | --------------> | Background Scheduler   |
|            (Authentication Gated)           |                 | (Live aggregation)     |
+--------------------+------------------------+                 +------------------------+
                     |
                     v
             +-------+-------+
             | Prisma Client |
             +-------+-------+
                     |
                     v
             +-------+-------+
             |  MongoDB DB   |
             +---------------+
```

### Recommended Design Patterns

1. **Incremental Updates**: Calculates statistics incrementally during session checkouts instead of running expensive table calculations on every page load.
2. **Tab-State Aware Polling**: Pauses request loops when window tabs are inactive, saving up to 80% of background server query load.
3. **Decoupled User Resolvers**: Fetches user names separately in one batch request instead of using database joins, preventing slow collection scans.

### Identified Technical Debt

1. **Inline CSS Styling**: The layout uses manual styling declarations instead of standard Tailwind utility classes, which can affect layout maintenance.
2. **In-process Memory Cache**: The L1 cache is stored in-process, meaning cache tables are reset whenever the Node process restarts on cPanel.
3. **No Database Rollbacks**: The system does not use database transactions on critical updates, which can lead to data mismatches if database operations fail mid-execution.
