'use client'

import { useCallback, useEffect, useState, Suspense } from 'react'
import Navigation from '@/components/Navigation'
import { Crown, Loader2, Trophy, Users, Star, Sparkles } from 'lucide-react'
import { motion } from 'framer-motion'
import { format, subMonths } from 'date-fns'
import { useVisibilityPolling } from '@/hooks/useVisibilityPolling'

type LeaderRow = {
  rank: number
  id: string
  name: string
  profileImageUrl: string | null
  verifiedCount: number
}

type StarEmployee = {
  id: string
  name: string
  profileImageUrl: string | null
  verifiedCount: number
} | null

function Avatar({ src, name, size = 'md' }: { src: string | null; name: string; size?: 'sm' | 'md' | 'lg' }) {
  const sz = size === 'lg' ? 'w-20 h-20' : size === 'md' ? 'w-14 h-14' : 'w-9 h-9'
  const icon = size === 'lg' ? 'w-9 h-9' : size === 'md' ? 'w-6 h-6' : 'w-4 h-4'
  return (
    <div className={`${sz} rounded-full overflow-hidden bg-neutral-800 ring-2 ring-neutral-700 shrink-0`}>
      {src ? (
        <img src={src} alt={name} className="w-full h-full object-cover" />
      ) : (
        <div className="w-full h-full flex items-center justify-center text-neutral-600">
          <Users className={icon} aria-hidden />
        </div>
      )}
    </div>
  )
}

function WorkspaceContent() {
  const [leaderboard, setLeaderboard] = useState<LeaderRow[]>([])
  const [empOfMonth, setEmpOfMonth] = useState<StarEmployee>(null)
  const [risingStar, setRisingStar] = useState<StarEmployee>(null)
  const [starMonth, setStarMonth] = useState<string | null>(null)
  const [leaderboardMonth, setLeaderboardMonth] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    const [lbRes, starsRes] = await Promise.all([
      fetch('/api/employee/leaderboard', { credentials: 'include' }),
      fetch('/api/employee/monthly-stars', { credentials: 'include' }),
    ])
    if (lbRes.ok) {
      const j = await lbRes.json()
      if (Array.isArray(j.leaderboard)) setLeaderboard(j.leaderboard)
      if (j.month) setLeaderboardMonth(j.month)
    } else {
      setLeaderboard([])
    }
    if (starsRes.ok) {
      const j = await starsRes.json()
      setEmpOfMonth(j.employeeOfMonth ?? null)
      setRisingStar(j.risingStar ?? null)
      if (j.month) setStarMonth(j.month)
    }
    setLoading(false)
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  useVisibilityPolling(() => load(), [load], { intervalMs: 300_000, runOnMount: false })

  const starsMonthLabel = starMonth
    ? format(new Date(starMonth), 'MMMM yyyy')
    : format(subMonths(new Date(), 1), 'MMMM yyyy')

  const leaderboardMonthLabel = leaderboardMonth
    ? format(new Date(leaderboardMonth), 'MMMM yyyy')
    : format(new Date(), 'MMMM yyyy')

  if (loading) {
    return (
      <div className="min-h-screen bg-neutral-950 flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-blue-500" />
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-neutral-950 text-neutral-200 relative overflow-hidden">
      <div
        className="pointer-events-none fixed inset-0 bg-[radial-gradient(ellipse_100%_60%_at_50%_-15%,rgba(59,130,246,0.11),transparent_55%)]"
        aria-hidden
      />
      <Navigation />
      <main className="relative max-w-[1100px] mx-auto px-4 sm:px-6 lg:px-8 py-8 sm:py-10">
        <header className="space-y-1 mb-8">
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-white">Your workspace</h1>
          <p className="text-sm text-neutral-500">
            {starsMonthLabel} awards · {leaderboardMonthLabel} leaderboard (verified this month).
          </p>
        </header>

        <div className="flex flex-col lg:flex-row gap-5 items-start">

          {/* Left — recognition cards */}
          <div className="w-full lg:w-[260px] shrink-0 space-y-4">

            {/* Employee of the Month */}
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.05 }}
              className="rounded-2xl border border-amber-500/20 bg-gradient-to-b from-amber-500/[0.08] to-neutral-900/80 p-5 ring-1 ring-amber-500/10 shadow-lg shadow-black/20"
            >
              <div className="flex items-center gap-2 mb-4">
                <Crown className="w-4 h-4 text-amber-400" />
                <span className="text-[11px] font-semibold uppercase tracking-wider text-amber-400/80">
                  Employee of the Month
                </span>
              </div>
              <p className="text-[10px] text-neutral-500 mb-3">{starsMonthLabel}</p>

              {empOfMonth ? (
                <div className="flex flex-col items-center text-center gap-3">
                  <div className="relative">
                    <div className="w-20 h-20 rounded-full overflow-hidden bg-neutral-800 ring-2 ring-amber-500/40 shadow-lg shadow-amber-900/20">
                      {empOfMonth.profileImageUrl ? (
                        <img src={empOfMonth.profileImageUrl} alt={empOfMonth.name} className="w-full h-full object-cover" />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center text-neutral-600">
                          <Users className="w-9 h-9" />
                        </div>
                      )}
                    </div>
                    <span className="absolute -bottom-1 -right-1 flex h-6 w-6 items-center justify-center rounded-full bg-amber-500 ring-2 ring-neutral-900">
                      <Crown className="w-3 h-3 text-black" />
                    </span>
                  </div>
                  <div>
                    <p className="text-base font-bold text-white leading-tight">{empOfMonth.name}</p>
                    <p className="text-xs text-emerald-400 mt-1 font-mono">{empOfMonth.verifiedCount} verified</p>
                  </div>
                </div>
              ) : (
                <div className="text-center py-4 text-neutral-600 text-xs">
                  No verified sales in {starsMonthLabel}
                </div>
              )}
            </motion.div>

            {/* Rising Star */}
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.1 }}
              className="rounded-2xl border border-violet-500/20 bg-gradient-to-b from-violet-500/[0.07] to-neutral-900/80 p-5 ring-1 ring-violet-500/10 shadow-lg shadow-black/20"
            >
              <div className="flex items-center gap-2 mb-4">
                <Sparkles className="w-4 h-4 text-violet-400" />
                <span className="text-[11px] font-semibold uppercase tracking-wider text-violet-400/80">
                  Rising Star
                </span>
              </div>
              <p className="text-[10px] text-neutral-500 mb-3">{starsMonthLabel} · joined &lt;3 months</p>

              {risingStar ? (
                <div className="flex flex-col items-center text-center gap-3">
                  <div className="relative">
                    <div className="w-20 h-20 rounded-full overflow-hidden bg-neutral-800 ring-2 ring-violet-500/40 shadow-lg shadow-violet-900/20">
                      {risingStar.profileImageUrl ? (
                        <img src={risingStar.profileImageUrl} alt={risingStar.name} className="w-full h-full object-cover" />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center text-neutral-600">
                          <Users className="w-9 h-9" />
                        </div>
                      )}
                    </div>
                    <span className="absolute -bottom-1 -right-1 flex h-6 w-6 items-center justify-center rounded-full bg-violet-500 ring-2 ring-neutral-900">
                      <Star className="w-3 h-3 text-white" />
                    </span>
                  </div>
                  <div>
                    <p className="text-base font-bold text-white leading-tight">{risingStar.name}</p>
                    <p className="text-xs text-emerald-400 mt-1 font-mono">{risingStar.verifiedCount} verified</p>
                  </div>
                </div>
              ) : (
                <div className="text-center py-4 text-neutral-600 text-xs">
                  No rising star for {starsMonthLabel} (join ≤3 months before month end)
                </div>
              )}
            </motion.div>

          </div>

          {/* Right — Leaderboard */}
          <section className="flex-1 min-w-0 rounded-2xl border border-white/[0.06] bg-neutral-900/70 backdrop-blur-sm p-6 sm:p-7 shadow-lg shadow-black/20 ring-1 ring-white/[0.04]">
            <div className="flex items-center gap-3 mb-6">
              <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-amber-500/10 ring-1 ring-amber-500/20">
                <Trophy className="w-5 h-5 text-amber-400" aria-hidden />
              </div>
              <div>
                <h2 className="text-lg font-semibold text-white">Representative Leaderboard</h2>
                <p className="text-xs text-neutral-500">Verified sales in {leaderboardMonthLabel}.</p>
              </div>
            </div>

            {/* Podium */}
            <div className="rounded-xl bg-gradient-to-b from-neutral-950/50 to-transparent border border-neutral-800/80 px-4 py-6 mb-6">
              <div className="flex justify-center items-end gap-4 sm:gap-10 min-h-[200px]">
                {[leaderboard[1], leaderboard[0], leaderboard[2]].map((row, idx) => {
                  if (!row) {
                    return (
                      <div key={`ph-${idx}`} className="w-[28%] max-w-[132px] opacity-30 text-center">
                        <div className="mx-auto w-16 h-16 rounded-full bg-neutral-800/80 border border-dashed border-neutral-700" />
                        <span className="text-[10px] text-neutral-600 block mt-2">Open</span>
                      </div>
                    )
                  }
                  const podium = idx === 1
                  return (
                    <motion.div
                      key={row.id}
                      className="flex flex-col items-center w-[30%] max-w-[150px]"
                      initial={{ opacity: 0, y: 12 }}
                      animate={{ opacity: 1, y: 0 }}
                    >
                      <div
                        className={`rounded-full overflow-hidden bg-neutral-800 ring-2 shadow-lg ${
                          row.rank === 1
                            ? 'ring-amber-400/60 shadow-amber-900/20'
                            : row.rank === 2
                              ? 'ring-slate-300/40'
                              : 'ring-orange-900/60'
                        } ${podium ? 'w-[4.75rem] h-[4.75rem]' : 'w-14 h-14'}`}
                      >
                        {row.profileImageUrl ? (
                          <img src={row.profileImageUrl} alt="" className="w-full h-full object-cover" />
                        ) : (
                          <div className="w-full h-full flex items-center justify-center text-neutral-600">
                            <Users className={podium ? 'w-9 h-9' : 'w-6 h-6'} aria-hidden />
                          </div>
                        )}
                      </div>
                      {row.rank === 1 ? <Crown className="w-5 h-5 text-amber-400 mt-1.5" /> : null}
                      <p className={`mt-2 text-center font-medium text-white ${podium ? 'text-sm max-w-[9rem]' : 'text-xs max-w-[7rem]'}`}>
                        {row.name}
                      </p>
                      <span className={`mt-1 text-[11px] font-mono tabular-nums ${row.verifiedCount > 0 ? 'text-emerald-400/90' : 'text-neutral-600'}`}>
                        {row.verifiedCount} verified
                      </span>
                    </motion.div>
                  )
                })}
              </div>
            </div>

            {/* Rest of leaderboard */}
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-wider text-neutral-600 mb-2">Other ranks</p>
              <ol className="space-y-2">
                {leaderboard.slice(3, 10).length === 0 ? (
                  <li className="text-sm text-neutral-600 py-6 text-center rounded-xl bg-neutral-950/40 border border-neutral-800/60">
                    No one else ranked yet — keep closing verified sales.
                  </li>
                ) : (
                  leaderboard.slice(3, 10).map((row) => (
                    <li
                      key={row.id}
                      className="flex items-center gap-3 rounded-xl bg-neutral-950/55 px-3.5 py-2 text-sm border border-neutral-800/70"
                    >
                      <span className="tabular-nums text-neutral-600 w-9 text-xs font-medium">#{row.rank}</span>
                      <span className="truncate flex-1 text-neutral-100">{row.name}</span>
                      <span className={`font-mono text-xs tabular-nums ${row.verifiedCount > 0 ? 'text-emerald-400/90' : 'text-neutral-600'}`}>
                        {row.verifiedCount} verified
                      </span>
                    </li>
                  ))
                )}
              </ol>
            </div>
          </section>

        </div>

        <footer className="mt-6 rounded-xl border border-neutral-800/80 bg-neutral-900/40 px-4 py-3 text-center text-xs text-neutral-500 leading-relaxed">
          Monthly incentive (verified count): 1 → ₹3,000 · 2 → ₹7,000 · 3 → ₹11,000 · 4 → ₹16,000 · 5+ → ₹25,000
        </footer>
      </main>
    </div>
  )
}

export default function EmployeeHubPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen bg-neutral-950 flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-blue-500" />
      </div>
    }>
      <WorkspaceContent />
    </Suspense>
  )
}
