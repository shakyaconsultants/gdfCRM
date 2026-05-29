# Bee CRM (GDF Internationals)

Multi-role telemarketing CRM: **Next.js 16**, **React 19**, **Prisma**, **MongoDB**. Production deployment uses **standalone output** on **cPanel** via `server.js`.

---

## Documentation for developers

| Document | Description |
|----------|-------------|
| **[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)** | **Full system guide** — deployment, auth, lead loading, polling, caching, admin page behavior, ~40k scale bottlenecks, and review questions for seniors |

Share **`docs/ARCHITECTURE.md`** with your senior developer for architecture review and optimization suggestions.

---

## Quick facts

- **~40,000+ leads** in production MongoDB (growing)
- **Admin leads:** 50 per page, server-paginated; optional background total count
- **Employee / advisor:** 50 per page + **delta polling** (`?since=`) every ~2 min when tab visible
- **No Redis** today — in-memory count cache + browser `sessionStorage` only
- **Roles:** `ADMIN`, `EMPLOYEE`, `ADVISOR`, `CASE_ASSESSOR`

---

## Tech stack

Next.js 16 · React 19 · Prisma 6 · MongoDB · JWT (`jose`) · Cloudinary · Tailwind CSS 4

---

## Environment

```env
DATABASE_URL="mongodb+srv://..."
JWT_SECRET="..."
ADMIN_EMAIL="admin@company.com"   # OTP for login
# SMTP + Cloudinary — see docs/ARCHITECTURE.md §17
```

---

## Setup

```bash
npm install
npx prisma generate
npx prisma db push
npm run dev
```

**Production (cPanel):**

```bash
npm run build    # postbuild prepares .next/standalone
npm start        # node server.js
```

Build on **Linux** when deploying to Linux cPanel (Prisma engine binaries).

---

## Project layout

```
crm/
├── server.js                 # Production entry (cPanel)
├── docs/ARCHITECTURE.md      # Detailed architecture (read this)
├── prisma/schema.prisma
├── src/
│   ├── app/                  # App Router pages + API routes
│   ├── components/
│   ├── hooks/                # useVisibilityPolling, etc.
│   └── lib/                  # DB, auth, lead sync, caches
└── scripts/prepare-standalone.mjs
```

---

## License / version

Internal production system — Bee CRM v2.x (2026).
