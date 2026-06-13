'use client'

import { useCallback, useEffect, useState } from 'react'
import Navigation from '@/components/Navigation'
import { ArrowRightLeft, ClipboardList, Loader2, Users } from 'lucide-react'
import { format, subDays } from 'date-fns'
import Link from 'next/link'

type WorkloadRow = {
  id: string
  name: string
  email: string
  totalAssigned: number
  stillNew: number
  inProgress: number
  referredToAdvisor: number
}

type AssignmentBatch = {
  id: string
  action: string
  leadCount: number
  employeeId: string | null
  employeeName: string | null
  previousEmployeeId: string | null
  previousEmployeeName: string | null
  importId: string | null
  importFileName: string | null
  performedById: string
  performedByName: string
  createdAt: string
}

const ACTIONS = ['', 'ASSIGN', 'TRANSFER', 'UNASSIGN'] as const

function actionLabel(action: string) {
  switch (action) {
    case 'ASSIGN':
      return 'Assigned'
    case 'TRANSFER':
      return 'Transferred'
    case 'UNASSIGN':
      return 'Unassigned'
    default:
      return action
  }
}

function actionBadgeClass(action: string) {
  switch (action) {
    case 'ASSIGN':
      return 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30'
    case 'TRANSFER':
      return 'bg-amber-500/15 text-amber-400 border-amber-500/30'
    case 'UNASSIGN':
      return 'bg-rose-500/15 text-rose-400 border-rose-500/30'
    default:
      return 'bg-neutral-800 text-neutral-400 border-neutral-700'
  }
}

export default function AdminAssignmentsPage() {
  const [loading, setLoading] = useState(true)
  const [batchesReady, setBatchesReady] = useState(true)
  const [workload, setWorkload] = useState<{
    unassignedPool: number
    assignedTotal: number
    employees: WorkloadRow[]
  } | null>(null)
  const [batches, setBatches] = useState<AssignmentBatch[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [totalPages, setTotalPages] = useState(1)
  const [filterAction, setFilterAction] = useState('')
  const [filterEmployeeId, setFilterEmployeeId] = useState('')
  const [dateFrom, setDateFrom] = useState(() => format(subDays(new Date(), 7), 'yyyy-MM-dd'))
  const [dateTo, setDateTo] = useState(() => format(new Date(), 'yyyy-MM-dd'))

  const fetchData = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams()
      params.set('page', String(page))
      params.set('pageSize', '30')
      if (filterAction) params.set('action', filterAction)
      if (filterEmployeeId) params.set('employeeId', filterEmployeeId)
      if (dateFrom) params.set('from', dateFrom)
      if (dateTo) params.set('to', dateTo)

      const res = await fetch(`/api/admin/assignment-batches?${params.toString()}`, {
        cache: 'no-store',
        credentials: 'include',
      })
      const data = await res.json().catch(() => ({}))
      if (res.ok) {
        setBatches(Array.isArray(data.batches) ? data.batches : [])
        setTotal(typeof data.total === 'number' ? data.total : 0)
        setTotalPages(typeof data.totalPages === 'number' ? data.totalPages : 1)
        setBatchesReady(data.batchesReady !== false)
        if (data.workload) setWorkload(data.workload)
      }
    } finally {
      setLoading(false)
    }
  }, [page, filterAction, filterEmployeeId, dateFrom, dateTo])

  useEffect(() => {
    void fetchData()
  }, [fetchData])

  useEffect(() => {
    setPage(1)
  }, [filterAction, filterEmployeeId, dateFrom, dateTo])

  const employees = workload?.employees ?? []

  return (
    <div className="min-h-screen bg-neutral-950 text-neutral-200">
      <Navigation />
      <main className="max-w-[1600px] w-full mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="mb-8">
          <h1 className="text-2xl sm:text-3xl font-bold text-white flex items-center gap-3">
            <ArrowRightLeft className="w-8 h-8 text-blue-500" />
            Lead assignments
          </h1>
          <p className="text-neutral-400 text-sm mt-2 max-w-3xl">
            Live workload per employee and a batch-level history of every assign, transfer, and
            unassign action from the admin leads page.
          </p>
        </div>

        {/* Current workload */}
        <section className="mb-8">
          <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
            <h2 className="text-lg font-bold text-white flex items-center gap-2">
              <Users className="w-5 h-5 text-cyan-500" />
              Current employee workload
            </h2>
            {workload && (
              <div className="flex flex-wrap gap-3 text-xs font-mono">
                <span className="px-3 py-1.5 rounded-lg bg-neutral-900 border border-neutral-800 text-neutral-400">
                  Assigned total:{' '}
                  <span className="text-white font-bold">{workload.assignedTotal.toLocaleString()}</span>
                </span>
                <span className="px-3 py-1.5 rounded-lg bg-neutral-900 border border-neutral-800 text-neutral-400">
                  Unassigned pool (New):{' '}
                  <span className="text-emerald-400 font-bold">
                    {workload.unassignedPool.toLocaleString()}
                  </span>
                </span>
              </div>
            )}
          </div>

          <div className="bg-neutral-900 border border-neutral-800 rounded-2xl overflow-hidden shadow-sm">
            <div className="overflow-x-auto max-h-[420px] overflow-y-auto">
              {loading && !workload ? (
                <div className="p-10 text-center text-neutral-500">
                  <Loader2 className="w-6 h-6 animate-spin mx-auto mb-2" />
                  Loading workload…
                </div>
              ) : !employees.length ? (
                <div className="p-10 text-center text-neutral-500">No employee accounts yet.</div>
              ) : (
                <table className="w-full text-left border-collapse text-sm">
                  <thead>
                    <tr className="bg-neutral-950/50 border-b border-neutral-800 text-[10px] uppercase tracking-wider text-neutral-500 sticky top-0 z-10">
                      <th className="p-3 pl-4 font-medium">Employee</th>
                      <th className="p-3 font-medium text-center">Total assigned</th>
                      <th className="p-3 font-medium text-center">Still New</th>
                      <th className="p-3 font-medium text-center">In progress</th>
                      <th className="p-3 font-medium text-center">Referred</th>
                      <th className="p-3 font-medium text-center pr-4">View leads</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-neutral-800/50">
                    {employees.map((row) => (
                      <tr key={row.id} className="hover:bg-neutral-800/25 transition-colors">
                        <td className="p-3 pl-4">
                          <div className="font-semibold text-white">{row.name}</div>
                          <div className="text-[11px] text-neutral-500 truncate max-w-[220px]">
                            {row.email}
                          </div>
                        </td>
                        <td className="p-3 text-center font-mono font-bold text-cyan-400">
                          {row.totalAssigned.toLocaleString()}
                        </td>
                        <td className="p-3 text-center font-mono text-emerald-400">
                          {row.stillNew.toLocaleString()}
                        </td>
                        <td className="p-3 text-center font-mono text-amber-400/90">
                          {row.inProgress.toLocaleString()}
                        </td>
                        <td className="p-3 text-center font-mono text-indigo-400">
                          {row.referredToAdvisor.toLocaleString()}
                        </td>
                        <td className="p-3 text-center pr-4">
                          <Link
                            href={`/admin/leads?employee=${encodeURIComponent(row.id)}`}
                            className="text-xs font-bold text-blue-400 hover:text-blue-300 underline underline-offset-2"
                          >
                            Open
                          </Link>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </section>

        {/* Assignment history */}
        <section>
          <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-4 mb-4">
            <div>
              <h2 className="text-lg font-bold text-white flex items-center gap-2">
                <ClipboardList className="w-5 h-5 text-amber-500" />
                Assignment history
              </h2>
              <p className="text-neutral-500 text-xs mt-1">
                One row per admin action — not per lead. New actions appear after assign / transfer /
                unassign on the leads page.
              </p>
            </div>
            <div className="flex flex-wrap items-end gap-2">
              <label className="flex flex-col gap-1 text-[10px] uppercase tracking-wider text-neutral-500">
                From
                <input
                  type="date"
                  value={dateFrom}
                  onChange={(e) => setDateFrom(e.target.value)}
                  className="bg-neutral-900 border border-neutral-800 rounded-lg px-3 py-2 text-sm text-white"
                />
              </label>
              <label className="flex flex-col gap-1 text-[10px] uppercase tracking-wider text-neutral-500">
                To
                <input
                  type="date"
                  value={dateTo}
                  onChange={(e) => setDateTo(e.target.value)}
                  className="bg-neutral-900 border border-neutral-800 rounded-lg px-3 py-2 text-sm text-white"
                />
              </label>
              <label className="flex flex-col gap-1 text-[10px] uppercase tracking-wider text-neutral-500">
                Action
                <select
                  value={filterAction}
                  onChange={(e) => setFilterAction(e.target.value)}
                  className="bg-neutral-900 border border-neutral-800 rounded-lg px-3 py-2 text-sm text-white min-w-[8rem]"
                >
                  <option value="">All</option>
                  {ACTIONS.filter(Boolean).map((a) => (
                    <option key={a} value={a}>
                      {actionLabel(a)}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex flex-col gap-1 text-[10px] uppercase tracking-wider text-neutral-500">
                Employee
                <select
                  value={filterEmployeeId}
                  onChange={(e) => setFilterEmployeeId(e.target.value)}
                  className="bg-neutral-900 border border-neutral-800 rounded-lg px-3 py-2 text-sm text-white min-w-[10rem]"
                >
                  <option value="">All</option>
                  {employees.map((emp) => (
                    <option key={emp.id} value={emp.id}>
                      {emp.name}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          </div>

          {!batchesReady && (
            <div className="mb-4 px-4 py-3 rounded-xl border border-amber-500/30 bg-amber-500/10 text-amber-200 text-sm">
              Assignment history is not available yet — run{' '}
              <code className="font-mono text-xs">npx prisma db push</code> on the server after
              deploy.
            </div>
          )}

          <div className="bg-neutral-900 border border-neutral-800 rounded-2xl overflow-hidden shadow-sm">
            <div className="overflow-x-auto">
              {loading ? (
                <div className="p-10 text-center text-neutral-500">
                  <Loader2 className="w-6 h-6 animate-spin mx-auto mb-2" />
                  Loading history…
                </div>
              ) : batches.length === 0 ? (
                <div className="p-10 text-center text-neutral-500">
                  No assignment actions in this period.
                </div>
              ) : (
                <table className="w-full text-left border-collapse text-sm min-w-[720px]">
                  <thead>
                    <tr className="bg-neutral-950/50 border-b border-neutral-800 text-[10px] uppercase tracking-wider text-neutral-500">
                      <th className="p-3 pl-4 font-medium">When</th>
                      <th className="p-3 font-medium">Action</th>
                      <th className="p-3 font-medium text-center">Leads</th>
                      <th className="p-3 font-medium">Target / source</th>
                      <th className="p-3 font-medium">Import batch</th>
                      <th className="p-3 font-medium pr-4">By</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-neutral-800/50">
                    {batches.map((row) => (
                      <tr key={row.id} className="hover:bg-neutral-800/25 transition-colors">
                        <td className="p-3 pl-4 whitespace-nowrap">
                          <div className="text-white text-xs font-medium">
                            {format(new Date(row.createdAt), 'dd MMM yyyy')}
                          </div>
                          <div className="text-[10px] text-neutral-500 font-mono">
                            {format(new Date(row.createdAt), 'HH:mm:ss')}
                          </div>
                        </td>
                        <td className="p-3">
                          <span
                            className={`inline-flex px-2 py-0.5 rounded-md text-[10px] font-black uppercase tracking-wider border ${actionBadgeClass(row.action)}`}
                          >
                            {actionLabel(row.action)}
                          </span>
                        </td>
                        <td className="p-3 text-center font-mono font-bold text-white">
                          {row.leadCount.toLocaleString()}
                        </td>
                        <td className="p-3 text-xs text-neutral-300">
                          {row.action === 'UNASSIGN' ? (
                            row.previousEmployeeName ? (
                              <span>
                                From{' '}
                                <span className="text-white font-medium">{row.previousEmployeeName}</span>
                              </span>
                            ) : (
                              <span className="text-neutral-500">Mixed / unassigned pool</span>
                            )
                          ) : row.action === 'TRANSFER' ? (
                            <span>
                              <span className="text-neutral-500">{row.previousEmployeeName}</span>
                              <span className="text-neutral-600 mx-1">→</span>
                              <span className="text-white font-medium">{row.employeeName}</span>
                            </span>
                          ) : (
                            <span className="text-white font-medium">
                              {row.employeeName ?? '—'}
                            </span>
                          )}
                        </td>
                        <td className="p-3 text-xs text-neutral-400 max-w-[12rem] truncate" title={row.importFileName ?? ''}>
                          {row.importFileName ?? '—'}
                        </td>
                        <td className="p-3 pr-4 text-xs text-neutral-400">{row.performedByName}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>

            {totalPages > 1 && (
              <div className="border-t border-neutral-800 px-4 py-3 flex items-center justify-between gap-3 text-xs text-neutral-500">
                <span>
                  {total.toLocaleString()} action{total === 1 ? '' : 's'} · page {page} of{' '}
                  {totalPages}
                </span>
                <div className="flex gap-2">
                  <button
                    type="button"
                    disabled={page <= 1 || loading}
                    onClick={() => setPage((p) => p - 1)}
                    className="px-3 py-1.5 bg-neutral-800 hover:bg-neutral-700 disabled:opacity-30 rounded-md border border-neutral-700 text-white font-medium"
                  >
                    Prev
                  </button>
                  <button
                    type="button"
                    disabled={page >= totalPages || loading}
                    onClick={() => setPage((p) => p + 1)}
                    className="px-3 py-1.5 bg-neutral-800 hover:bg-neutral-700 disabled:opacity-30 rounded-md border border-neutral-700 text-white font-medium"
                  >
                    Next
                  </button>
                </div>
              </div>
            )}
          </div>
        </section>
      </main>
    </div>
  )
}
