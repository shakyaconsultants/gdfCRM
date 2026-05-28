'use client'

import { useState, useEffect, useCallback } from 'react'
import Navigation from '@/components/Navigation'
import AdminDateRangeFilter from '@/components/AdminDateRangeFilter'
import {
  PhoneCall,
  Users,
  ArrowRightLeft,
  CheckCircle2,
  Activity,
  Trophy,
  Clock,
  Phone,
  TrendingUp,
  Briefcase,
  ClipboardCheck,
} from 'lucide-react'
import { motion } from 'framer-motion'
import { formatDistanceToNow, subDays, format } from 'date-fns'

type AdvisorPerformanceRow = {
  id: string
  name: string
  email: string
  transferredFromEmployee: number
  forwardedToCaseAssessor: number
  verified: number
  dropped: number
  clawback: number
}

type CaseAssessorPerformanceRow = {
  id: string
  name: string
  email: string
  assignedTotal: number
  verified: number
  dropped: number
  clawback: number
  payments: number
}

export default function AdminDashboard() {
  const [metrics, setMetrics] = useState<any>(null)
  const [advisorPerformance, setAdvisorPerformance] = useState<AdvisorPerformanceRow[] | null>(null)
  const [assessorPerformance, setAssessorPerformance] = useState<CaseAssessorPerformanceRow[] | null>(
    null
  )
  const [loading, setLoading] = useState(true)
  const [dateFrom, setDateFrom] = useState(() => format(subDays(new Date(), 30), 'yyyy-MM-dd'))
  const [dateTo, setDateTo] = useState(() => format(new Date(), 'yyyy-MM-dd'))

  const loadMetrics = useCallback(async () => {
    setLoading(true)
    try {
      const qs = dateFrom && dateTo ? `?from=${dateFrom}&to=${dateTo}` : ''
      const res = await fetch(`/api/admin/dashboard${qs}`)
      const data = await res.json()
      if (data.metrics) setMetrics(data.metrics)
      setAdvisorPerformance(data.advisors?.perAdvisor ?? [])
      setAssessorPerformance(data.assessors?.perAssessor ?? [])
    } finally {
      setLoading(false)
    }
  }, [dateFrom, dateTo])

  useEffect(() => {
    loadMetrics()
  }, [loadMetrics])

  const stats = [
    { name: 'Total Leads Pool', value: metrics?.totalLeads ?? '-', icon: Users, color: 'text-blue-500', bg: 'bg-blue-500/10' },
    { name: 'Active Outbound Calls', value: metrics?.totalCalls ?? '-', icon: PhoneCall, color: 'text-indigo-500', bg: 'bg-indigo-500/10' },
    { name: 'Forwarded to Advisor', value: metrics?.moveCount ?? '-', icon: ArrowRightLeft, color: 'text-amber-500', bg: 'bg-amber-500/10' },
    { name: 'Verified', value: metrics?.verifiedCount ?? '-', icon: CheckCircle2, color: 'text-teal-500', bg: 'bg-teal-500/10' },
    { name: 'Clawbacks', value: metrics?.clawbackCount ?? '-', icon: TrendingUp, color: 'text-rose-500', bg: 'bg-rose-500/10' },
    { name: 'Dropped', value: metrics?.droppedCount ?? '-', icon: Trophy, color: 'text-orange-500', bg: 'bg-orange-500/10' },
  ]

  return (
    <div className="min-h-screen bg-neutral-950 text-neutral-200">
      <Navigation />
      
      <main className="max-w-[1600px] w-full mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="mb-6 flex flex-col gap-4 lg:flex-row lg:justify-between lg:items-end">
          <div>
            <h1 className="text-3xl font-bold text-white flex items-center gap-3">
              <Activity className="w-8 h-8 text-blue-500" /> Executive Operations Control
            </h1>
            <p className="text-neutral-400 text-sm mt-2">
              Team metrics and representative leaderboard. Counts are based on lead activity in the period (by last update) unless you choose all time.
            </p>
            {metrics?.range ? (
              <p className="text-xs text-amber-500/90 mt-2 font-mono">
                Period: {metrics.range.from} → {metrics.range.to}
              </p>
            ) : (
              <p className="text-xs text-neutral-500 mt-2">Showing all-time data</p>
            )}
          </div>
          <div className="text-xs font-mono text-neutral-500 flex items-center gap-2 shrink-0">
            <span className="relative flex h-2.5 w-2.5">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-500"></span>
            </span>
            Live
          </div>
        </div>

        <div className="mb-6">
          <AdminDateRangeFilter
            dateFrom={dateFrom}
            dateTo={dateTo}
            onDateFromChange={setDateFrom}
            onDateToChange={setDateTo}
            onAllTime={() => {
              setDateFrom('')
              setDateTo('')
            }}
          />
        </div>

        {/* Top Operations KPI Modules */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4 mb-8">
          {stats.map((stat, index) => {
            const Icon = stat.icon
            return (
              <motion.div
                key={stat.name}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: index * 0.05 }}
                className="bg-neutral-900 border border-neutral-800 rounded-2xl p-5 relative overflow-hidden group hover:border-neutral-700 transition-colors shadow-sm"
              >
                <div className="flex flex-col h-full justify-between gap-4">
                  <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${stat.bg}`}>
                    <Icon className={`w-5 h-5 ${stat.color}`} />
                  </div>
                  <div>
                    <p className="text-3xl font-bold text-white tracking-tight">{stat.value}</p>
                    <p className="text-xs font-medium text-neutral-500 uppercase tracking-wide mt-1">{stat.name}</p>
                  </div>
                </div>
              </motion.div>
            )
          })}
        </div>

        {/* Advisor & case assessor performance (same date range as above) */}
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-6 mb-8">
          <div className="bg-neutral-900 border border-neutral-800 rounded-2xl overflow-hidden shadow-sm">
            <div className="p-5 border-b border-neutral-800 bg-neutral-900/50 flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-base font-bold text-white flex items-center gap-2">
                <Briefcase className="w-5 h-5 text-amber-500" /> Advisor performance
              </h2>
              <span className="text-[10px] uppercase tracking-wider text-neutral-500 font-medium">
                Transfer flow & outcomes
              </span>
            </div>
            <div className="overflow-x-auto max-h-[420px] overflow-y-auto">
              {loading ? (
                <div className="p-8 text-center text-neutral-500 text-sm">Loading…</div>
              ) : !advisorPerformance?.length ? (
                <div className="p-8 text-center text-neutral-500 text-sm">No advisor accounts yet.</div>
              ) : (
                <table className="w-full text-left border-collapse text-sm">
                  <thead>
                    <tr className="bg-neutral-950/50 border-b border-neutral-800 text-[10px] uppercase tracking-wider text-neutral-500">
                      <th className="p-3 pl-4 font-medium">Advisor</th>
                      <th className="p-3 font-medium text-center">Transferred from employee</th>
                      <th className="p-3 font-medium text-center">Forwarded to case assessor</th>
                      <th className="p-3 font-medium text-center">Verified</th>
                      <th className="p-3 font-medium text-center">Dropped</th>
                      <th className="p-3 font-medium text-center pr-4">Clawback</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-neutral-800/50">
                    {advisorPerformance.map((row) => (
                      <tr key={row.id} className="hover:bg-neutral-800/25 transition-colors">
                        <td className="p-3 pl-4">
                          <div className="font-semibold text-white">{row.name}</div>
                          <div className="text-[11px] text-neutral-500 truncate max-w-[200px]" title={row.email}>
                            {row.email}
                          </div>
                        </td>
                        <td className="p-3 text-center font-mono text-cyan-400/90">{row.transferredFromEmployee}</td>
                        <td className="p-3 text-center font-mono text-indigo-400">{row.forwardedToCaseAssessor}</td>
                        <td className="p-3 text-center font-mono text-teal-400">{row.verified}</td>
                        <td className="p-3 text-center font-mono font-bold text-amber-400">{row.dropped}</td>
                        <td className="p-3 text-center font-mono font-bold text-rose-400 pr-4">{row.clawback}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>

          <div className="bg-neutral-900 border border-neutral-800 rounded-2xl overflow-hidden shadow-sm">
            <div className="p-5 border-b border-neutral-800 bg-neutral-900/50 flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-base font-bold text-white flex items-center gap-2">
                <ClipboardCheck className="w-5 h-5 text-cyan-500" /> Case assessor performance
              </h2>
              <span className="text-[10px] uppercase tracking-wider text-neutral-500 font-medium">
                Assigned leads & outcomes
              </span>
            </div>
            <div className="overflow-x-auto max-h-[420px] overflow-y-auto">
              {loading ? (
                <div className="p-8 text-center text-neutral-500 text-sm">Loading…</div>
              ) : !assessorPerformance?.length ? (
                <div className="p-8 text-center text-neutral-500 text-sm">No case assessor accounts yet.</div>
              ) : (
                <table className="w-full text-left border-collapse text-sm">
                  <thead>
                    <tr className="bg-neutral-950/50 border-b border-neutral-800 text-[10px] uppercase tracking-wider text-neutral-500">
                      <th className="p-3 pl-4 font-medium">Assessor</th>
                      <th className="p-3 font-medium text-center">Assigned</th>
                      <th className="p-3 font-medium text-center">Verified</th>
                      <th className="p-3 font-medium text-center">Dropped</th>
                      <th className="p-3 font-medium text-center">Clawback</th>
                      <th className="p-3 font-medium text-center pr-4">Paid</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-neutral-800/50">
                    {assessorPerformance.map((row) => (
                      <tr key={row.id} className="hover:bg-neutral-800/25 transition-colors">
                        <td className="p-3 pl-4">
                          <div className="font-semibold text-white">{row.name}</div>
                          <div className="text-[11px] text-neutral-500 truncate max-w-[200px]" title={row.email}>
                            {row.email}
                          </div>
                        </td>
                        <td className="p-3 text-center font-mono text-cyan-400/90">{row.assignedTotal}</td>
                        <td className="p-3 text-center font-mono text-teal-400">{row.verified}</td>
                        <td className="p-3 text-center font-mono font-bold text-amber-400">{row.dropped}</td>
                        <td className="p-3 text-center font-mono font-bold text-rose-400">{row.clawback}</td>
                        <td className="p-3 text-center font-mono text-neutral-300 pr-4">{row.payments}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          
          {/* Representative Leaderboard */}
          <div className="lg:col-span-2 space-y-6">
            <div className="bg-neutral-900 border border-neutral-800 rounded-2xl overflow-hidden shadow-sm">
               <div className="p-6 border-b border-neutral-800 bg-neutral-900/50 flex justify-between items-center">
                 <h2 className="text-lg font-bold text-white flex items-center gap-2">
                   <Trophy className="w-5 h-5 text-amber-500" /> Representative Leaderboard
                 </h2>
                 <span className="text-xs bg-neutral-800 text-neutral-400 px-2.5 py-1 rounded-full font-medium">Ranked by Verified</span>
               </div>
               <div className="p-0">
                  {loading ? (
                     <div className="p-8 text-center text-neutral-500">Loading ranks...</div>
                  ) : metrics?.leaderboard?.length === 0 ? (
                     <div className="p-8 text-center text-neutral-500">No active employees found.</div>
                  ) : (
                     <div className="overflow-x-auto max-h-[600px] overflow-y-auto">
                        <table className="w-full text-left border-collapse">
                          <thead>
                            <tr className="bg-neutral-950/50 border-b border-neutral-800 text-xs uppercase tracking-wider text-neutral-500">
                              <th className="p-4 font-medium pl-6">Rank</th>
                              <th className="p-4 font-medium">Representative</th>
                              <th className="p-4 font-medium text-center">Dropped</th>
                              <th className="p-4 font-medium text-center">Verified</th>
                              <th className="p-4 font-medium text-center pr-6">Clawback</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-neutral-800/50">
                            {metrics?.leaderboard?.map((emp: any, idx: number) => {
                               return (
                                 <tr key={emp.name} className="hover:bg-neutral-800/30 transition-colors">
                                   <td className="p-4 pl-6 text-2xl font-black text-neutral-700 italic">#{idx + 1}</td>
                                   <td className="p-4">
                                     <div className="font-semibold text-white">{emp.name}</div>
                                   </td>
                                   <td className="p-4 text-center font-bold text-amber-400">{emp.droppedCount}</td>
                                   <td className="p-4 text-center font-bold text-emerald-400">{emp.verifiedCount}</td>
                                   <td className="p-4 text-center font-bold text-rose-400 pr-6">{emp.clawbackCount}</td>
                                 </tr>
                               )
                            })}
                          </tbody>
                        </table>
                     </div>
                  )}
               </div>
            </div>

            {/* Performance Analysis Graph Placeholder */}
             <div className="bg-gradient-to-br from-indigo-900/20 to-blue-900/10 border border-indigo-500/20 rounded-2xl p-8 flex items-center justify-between">
                <div>
                   <h3 className="text-xl font-bold text-indigo-300">Pipeline Velocity</h3>
                   <p className="text-indigo-200/60 text-sm mt-1 max-w-sm">Global closure rates are outperforming last quarter expectations across the active workforce.</p>
                </div>
                <div className="hidden sm:flex items-end gap-2 h-24">
                   <div className="w-8 bg-indigo-500/40 rounded-t-sm h-1/4"></div>
                   <div className="w-8 bg-indigo-500/60 rounded-t-sm h-2/4"></div>
                   <div className="w-8 bg-indigo-500/80 rounded-t-sm h-3/4"></div>
                   <div className="w-8 bg-indigo-400 rounded-t-sm h-full shadow-[0_0_15px_rgba(129,140,248,0.5)]"></div>
                </div>
             </div>
          </div>

          {/* Right Panel: Live Activity Feed */}
          <div className="space-y-6">
            <div className="bg-neutral-900 border border-neutral-800 rounded-2xl overflow-hidden shadow-sm h-full flex flex-col">
              <div className="p-6 border-b border-neutral-800 bg-neutral-900/50 flex justify-between items-center">
                 <h2 className="text-lg font-bold text-white flex items-center gap-2">
                   <Clock className="w-5 h-5 text-blue-500" /> Operations Feed
                 </h2>
               </div>
               
               <div className="p-6 flex-1 overflow-y-auto max-h-[600px]">
                 {loading ? (
                    <div className="space-y-4">
                      {[1,2,3,4].map(i => <div key={i} className="h-16 bg-neutral-800/30 rounded-lg animate-pulse" />)}
                    </div>
                 ) : metrics?.recentActivity?.length === 0 ? (
                    <div className="text-center text-neutral-500 py-10">No recent activity detected.</div>
                 ) : (
                    <div className="space-y-6 relative before:absolute before:inset-0 before:ml-5 before:-translate-x-px md:before:mx-auto md:before:translate-x-0 before:h-full before:w-0.5 before:bg-gradient-to-b before:from-transparent before:via-neutral-800 before:to-transparent">
                      {metrics?.recentActivity?.map((lead: any) => (
                         <div key={lead.id} className="relative flex items-center justify-between md:justify-normal md:odd:flex-row-reverse group is-active">
                             <div className="flex items-center justify-center w-10 h-10 rounded-full border-4 border-neutral-900 bg-neutral-800 text-neutral-500 shadow shrink-0 md:order-1 md:group-odd:-translate-x-1/2 md:group-even:translate-x-1/2 z-10">
                               <TrendingUp className="w-4 h-4 text-emerald-500" />
                             </div>
                             <div className="w-[calc(100%-4rem)] md:w-[calc(50%-2.5rem)] p-4 rounded-xl border border-neutral-800 bg-neutral-950 shadow-sm">
                               <div className="flex items-center justify-between mb-1">
                                  <div className="text-xs font-bold text-blue-400 uppercase tracking-wider">{lead.assignedTo?.name || 'System'}</div>
                                  <time className="text-[10px] font-mono text-neutral-500">{formatDistanceToNow(new Date(lead.updatedAt))} ago</time>
                               </div>
                               <div className="text-sm text-neutral-300 font-medium">{lead.firstName} {lead.lastName}</div>
                               <div className="text-xs text-neutral-500 mt-1 flex items-center gap-1.5"><Phone className="w-3 h-3" /> Status: <span className="text-white">{lead.disposition}</span></div>
                             </div>
                         </div>
                      ))}
                    </div>
                 )}
               </div>
            </div>
          </div>

        </div>
      </main>
    </div>
  )
}
