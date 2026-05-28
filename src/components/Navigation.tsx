'use client'

import { useState, useEffect } from 'react'
import { usePathname } from 'next/navigation'
import { LogOut, User, Menu, X } from 'lucide-react'
import Link from 'next/link'
import { USER_CACHE_KEY, clearUserSessionCache } from '@/lib/auth-session'

const ADMIN_NAV_LINKS = [
  { href: '/admin', label: 'Dashboard', exact: true },
  { href: '/admin/leads', label: 'Leads' },
  { href: '/admin/employees', label: 'Teams' },
  { href: '/admin/payroll', label: 'Payroll' },
  { href: '/admin/leave-requests', label: 'Leave' },
  { href: '/admin/attendance-review', label: 'Attendance' },
  { href: '/admin/advisors', label: 'Advisors' },
  { href: '/admin/case-assessors', label: 'Assessors' },
  { href: '/admin/cases', label: 'Cases' },
] as const

function adminLinkActive(pathname: string, href: string, exact?: boolean) {
  if (exact) return pathname === href
  return pathname === href || pathname.startsWith(`${href}/`)
}


export default function Navigation() {
  const pathname = usePathname()
  const [user, setUser] = useState<{
    name: string
    role: string
    profileImageUrl?: string | null
    crmAccess?: boolean
  } | null>(null)
  const [mobileOpen, setMobileOpen] = useState(false)
  const isAdminContext = pathname === '/admin' || pathname.startsWith('/admin/')
  const isEmployeeCrm =
    pathname === '/employee/crm' || pathname.startsWith('/employee/crm/')

  useEffect(() => {
    const CACHE_TTL_MS = 5 * 60 * 1000

    const load = (skipCache = false) => {
      if (!skipCache && typeof sessionStorage !== 'undefined') {
        try {
          const raw = sessionStorage.getItem(USER_CACHE_KEY)
          if (raw) {
            const { user: cached, at } = JSON.parse(raw) as {
              user: { name: string; role: string; profileImageUrl?: string | null; crmAccess?: boolean }
              at: number
            }
            if (cached && Date.now() - at < CACHE_TTL_MS) {
              setUser(cached)
              return
            }
          }
        } catch {
          /* ignore */
        }
      }
      fetch('/api/user')
        .then((res) => res.json())
        .then((data) => {
          if (data.user) {
            setUser(data.user)
            try {
              sessionStorage.setItem(
                USER_CACHE_KEY,
                JSON.stringify({ user: data.user, at: Date.now() })
              )
            } catch {
              /* ignore */
            }
          }
        })
        .catch(() => {})
    }
    load()
    const onUpdate = () => load(true)
    window.addEventListener('gdf:user-updated', onUpdate)
    return () => window.removeEventListener('gdf:user-updated', onUpdate)
  }, [])

  const logoutScope: 'hub' | 'crm' = isEmployeeCrm ? 'crm' : 'hub'

  const handleLogout = async () => {
    await fetch('/api/auth/logout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ scope: logoutScope }),
    })
    clearUserSessionCache()
    setUser(null)
    setMobileOpen(false)
    const dest = logoutScope === 'crm' ? '/crm-access' : '/login'
    window.location.replace(dest)
  }

  const showEmployeeNav = user?.role === 'EMPLOYEE' && !isAdminContext
  const showAdvisorNav = user?.role === 'ADVISOR' && !isAdminContext
  const showAssessorNav = user?.role === 'CASE_ASSESSOR' && !isAdminContext

  return (
    <nav className="bg-neutral-950/95 backdrop-blur-md border-b border-neutral-800/80 sticky top-0 z-50">
      <div className="max-w-[1600px] mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex justify-between min-h-16 py-2 md:py-0 md:h-16 md:items-center">
          <div className="flex flex-col md:flex-row md:items-center gap-2 md:gap-4 min-w-0 flex-1">
            <Link
              href="/"
              className="flex items-center gap-2 shrink-0 group"
              aria-label="GDF Internationals — back to website"
            >
              <span className="text-white font-bold text-lg hidden sm:block tracking-tight group-hover:text-amber-200/90 transition-colors">
                GDF Internationals
              </span>
              <span className="text-white font-bold text-lg sm:hidden tracking-tight group-hover:text-amber-200/90 transition-colors">
                GDF
              </span>
            </Link>
            {isAdminContext && (
              <div className="hidden md:flex flex-wrap items-center gap-x-0.5 gap-y-1 ml-0 md:ml-4 pl-0 md:pl-4 md:border-l border-neutral-800 min-w-0">
                {ADMIN_NAV_LINKS.map((item) => {
                  const active = adminLinkActive(pathname, item.href, 'exact' in item ? item.exact : false)
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      className={`px-2.5 py-1.5 rounded-md text-sm transition-colors whitespace-nowrap ${
                        active
                          ? 'bg-neutral-800 text-white font-medium'
                          : 'text-neutral-400 hover:text-white hover:bg-neutral-800/60'
                      }`}
                    >
                      {item.label}
                    </Link>
                  )
                })}
              </div>
            )}
            {showAssessorNav && (
              <div className="hidden md:flex items-center space-x-4 ml-6 pl-6 border-l border-neutral-800 text-sm">
                <Link href="/case-assessor" className="text-cyan-500 hover:text-cyan-400 transition-colors">My cases</Link>
              </div>
            )}
            {showAdvisorNav && (
              <div className="hidden md:flex items-center space-x-4 ml-6 pl-6 border-l border-neutral-800 text-sm">
                <span className="text-amber-500 font-medium">Advisor Workspace</span>
              </div>
            )}
            {showEmployeeNav && isEmployeeCrm && (
              <div className="hidden md:flex items-center ml-6 pl-6 border-l border-neutral-800 text-sm">
                <span className="px-2.5 py-1.5 rounded-md bg-neutral-800 text-white font-medium">
                  CRM
                </span>
              </div>
            )}
            {showEmployeeNav && !isEmployeeCrm && (
              <div className="hidden md:flex items-center gap-1 ml-6 pl-6 border-l border-neutral-800 text-sm">
                {[
                  { href: '/employee', label: 'Workspace', exact: true },
                  { href: '/employee/attendance', label: 'Attendance', exact: false },
                  { href: '/employee/leaves', label: 'Leaves', exact: false },
                  { href: '/employee/settings', label: 'Settings', exact: false },
                ].map(({ href, label, exact }) => (
                  <Link
                    key={href}
                    href={href}
                    className={`px-2.5 py-1.5 rounded-md transition-colors ${
                      (exact ? pathname === href : pathname.startsWith(href))
                        ? 'bg-neutral-800 text-white font-medium'
                        : 'text-neutral-400 hover:text-white hover:bg-neutral-800/60'
                    }`}
                  >
                    {label}
                  </Link>
                ))}
              </div>
            )}
          </div>

          <div className="hidden md:flex items-center border-l border-neutral-800 pl-6 ml-6">
            <div className="flex items-center gap-3 mr-6">
              <div className="w-9 h-9 rounded-full overflow-hidden bg-neutral-800 shrink-0 flex items-center justify-center ring-1 ring-neutral-700">
                {user?.profileImageUrl ? (
                  <img
                    src={user.profileImageUrl}
                    alt=""
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <User className="w-4 h-4 text-neutral-400" aria-hidden />
                )}
              </div>
              <div>
                <p className="text-sm font-medium text-white leading-none">{user?.name || 'Loading...'}</p>
                <p className="text-xs text-neutral-500 mt-1">{user?.role}</p>
              </div>
            </div>
            <button
              onClick={handleLogout}
              className="text-neutral-400 hover:text-red-400 transition-colors p-2"
              title={logoutScope === 'crm' ? 'Log out of CRM' : 'Log out'}
            >
              <LogOut className="w-5 h-5" />
            </button>
          </div>

          <div className="flex items-center md:hidden">
            <button
              onClick={() => setMobileOpen(!mobileOpen)}
              className="text-neutral-400 hover:text-white p-2"
            >
              {mobileOpen ? <X className="w-6 h-6" /> : <Menu className="w-6 h-6" />}
            </button>
          </div>
        </div>
      </div>

      {mobileOpen && (
        <div className="md:hidden border-t border-neutral-800 bg-neutral-950 pb-4">
          <div className="px-4 py-3 border-b border-neutral-800 flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-white">{user?.name || 'Loading...'}</p>
              <p className="text-xs text-neutral-500">{user?.role}</p>
            </div>
            <button onClick={handleLogout} className="text-neutral-400 hover:text-red-400 text-sm flex items-center gap-2">
              <LogOut className="w-4 h-4" /> {logoutScope === 'crm' ? 'Log out of CRM' : 'Log out'}
            </button>
          </div>
          {isAdminContext && (
            <div className="px-2 pt-2 pb-3 space-y-0.5">
              <p className="px-3 pt-1 pb-2 text-[10px] font-semibold uppercase tracking-wider text-neutral-500">Admin</p>
              {ADMIN_NAV_LINKS.map((item) => {
                const active = adminLinkActive(pathname, item.href, 'exact' in item ? item.exact : false)
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    onClick={() => setMobileOpen(false)}
                    className={`block px-3 py-2.5 text-sm font-medium rounded-md ${
                      active ? 'bg-neutral-800 text-white' : 'text-neutral-300 hover:text-white hover:bg-neutral-800/80'
                    }`}
                  >
                    {item.label}
                  </Link>
                )
              })}
            </div>
          )}
          {showEmployeeNav && isEmployeeCrm && (
            <div className="px-2 pt-2 pb-3 border-t border-neutral-800">
              <span className="block px-3 py-2.5 text-sm font-medium rounded-md bg-neutral-800 text-white">
                CRM
              </span>
            </div>
          )}
          {showEmployeeNav && !isEmployeeCrm && (
            <div className="px-2 pt-2 pb-3 space-y-0.5 border-t border-neutral-800">
              <p className="px-3 pt-2 pb-1 text-[10px] font-semibold uppercase tracking-wider text-neutral-500">Employee</p>
              {[
                { href: '/employee', label: 'Workspace', exact: true },
                { href: '/employee/attendance', label: 'Attendance', exact: false },
                { href: '/employee/leaves', label: 'Leaves', exact: false },
                { href: '/employee/settings', label: 'Settings', exact: false },
              ].map(({ href, label, exact }) => (
                <Link
                  key={href}
                  href={href}
                  onClick={() => setMobileOpen(false)}
                  className={`block px-3 py-2.5 text-sm font-medium rounded-md ${
                    (exact ? pathname === href : pathname.startsWith(href))
                      ? 'bg-neutral-800 text-white'
                      : 'text-neutral-300 hover:text-white hover:bg-neutral-800/80'
                  }`}
                >
                  {label}
                </Link>
              ))}
            </div>
          )}
          {showAssessorNav && (
            <div className="px-2 pt-2 pb-3 space-y-1">
              <Link href="/case-assessor" className="block px-3 py-2 text-base font-medium text-cyan-500 hover:text-cyan-400 hover:bg-neutral-800 rounded-md">My cases</Link>
            </div>
          )}
          {showAdvisorNav && (
            <div className="px-2 pt-2 pb-3 space-y-1">
              <span className="block px-3 py-2 text-base font-medium text-amber-500">Advisor Workspace</span>
            </div>
          )}
        </div>
      )}
    </nav>
  )
}
