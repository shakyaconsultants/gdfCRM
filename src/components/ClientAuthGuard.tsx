'use client'

import { useEffect } from 'react'
import { usePathname, useRouter } from 'next/navigation'

const PROTECTED_PREFIXES = ['/admin', '/employee', '/advisor', '/case-assessor']

function isProtectedPath(pathname: string) {
  return PROTECTED_PREFIXES.some(
    (p) => pathname === p || pathname.startsWith(`${p}/`)
  )
}

function loginPathFor(pathname: string) {
  if (pathname.startsWith('/employee/crm')) return '/crm-access'
  return '/login'
}

/** Re-check session after logout + browser back (bfcache). */
export default function ClientAuthGuard({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const router = useRouter()

  useEffect(() => {
    if (!isProtectedPath(pathname)) return

    const verify = async () => {
      try {
        const res = await fetch('/api/user', { credentials: 'include', cache: 'no-store' })
        if (res.status === 401 || res.status === 403) {
          const dest = loginPathFor(pathname)
          router.replace(dest)
        }
      } catch {
        router.replace(loginPathFor(pathname))
      }
    }

    void verify()

    const onPageShow = (event: PageTransitionEvent) => {
      if (event.persisted) void verify()
    }

    window.addEventListener('pageshow', onPageShow)
    return () => window.removeEventListener('pageshow', onPageShow)
  }, [pathname, router])

  return <>{children}</>
}
