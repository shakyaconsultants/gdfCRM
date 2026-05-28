'use client'

import { useCallback, useEffect, useState } from 'react'
import Navigation from '@/components/Navigation'
import { ClipboardCheck, Loader2 } from 'lucide-react'
import { useVisibilityPolling } from '@/hooks/useVisibilityPolling'

type CaseRow = {
  id: string
  firstName: string | null
  lastName: string | null
  email: string | null
  addressLine1: string | null
  addressLine2: string | null
  addressLine3: string | null
  addressLine4: string | null
  phone: string
  caseStatus: string
  preSipAt: string | null
  assignedTo: { name: string } | null
  assignedAdvisor: { name: string } | null
  assignedCaseAssessor: { name: string } | null
  updatedAt: string
}

export default function AdminCasesPage() {
  const [rows, setRows] = useState<CaseRow[]>([])
  const [loading, setLoading] = useState(true)
  const [currentPage, setCurrentPage] = useState(1)
  const [total, setTotal] = useState(0)
  const [totalPages, setTotalPages] = useState(1)
  const pageSize = 50

  const load = useCallback(async (opts?: { silent?: boolean }) => {
    if (!opts?.silent) setLoading(true)
    try {
      const params = new URLSearchParams({
        page: String(currentPage),
        pageSize: String(pageSize),
      })
      const res = await fetch(`/api/admin/cases?${params}`)
      const data = await res.json()
      if (Array.isArray(data.cases)) setRows(data.cases)
      if (typeof data.total === 'number') setTotal(data.total)
      if (typeof data.totalPages === 'number') setTotalPages(data.totalPages)
    } finally {
      if (!opts?.silent) setLoading(false)
    }
  }, [currentPage])

  useEffect(() => {
    void load()
  }, [load])

  useVisibilityPolling(() => load({ silent: true }), [load], { intervalMs: 180_000, runOnMount: false })

  const pageStart = total === 0 ? 0 : (currentPage - 1) * pageSize + 1
  const pageEnd = Math.min(currentPage * pageSize, total)

  return (
    <div className="min-h-screen bg-neutral-950 text-neutral-200">
      <Navigation />
      <main className="max-w-[1400px] mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <h1 className="text-2xl font-bold text-white flex items-center gap-2 mb-2">
          <ClipboardCheck className="w-7 h-7 text-cyan-500" />
          Cases
        </h1>
        <p className="text-neutral-400 text-sm mb-6">Leads with a case assessor assigned.</p>

        <div className="bg-neutral-900/50 border border-neutral-800 rounded-2xl overflow-hidden">
          {loading ? (
            <div className="p-12 text-center text-neutral-500">
              <Loader2 className="w-6 h-6 animate-spin mx-auto mb-2" />
              Loading cases…
            </div>
          ) : rows.length === 0 ? (
            <div className="p-12 text-center text-neutral-500">No cases found.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="border-b border-neutral-800 text-[10px] uppercase tracking-wider text-neutral-400">
                  <tr>
                    <th className="p-4">Lead</th>
                    <th className="p-4">Phone</th>
                    <th className="p-4">Status</th>
                    <th className="p-4">Employee</th>
                    <th className="p-4">Advisor</th>
                    <th className="p-4">Assessor</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-neutral-800/50">
                  {rows.map((r) => (
                    <tr key={r.id} className="hover:bg-neutral-800/30">
                      <td className="p-4 font-medium text-white">
                        {[r.firstName, r.lastName].filter(Boolean).join(' ') || '—'}
                      </td>
                      <td className="p-4 font-mono text-neutral-300">{r.phone}</td>
                      <td className="p-4 text-cyan-400 text-xs font-bold">{r.caseStatus}</td>
                      <td className="p-4 text-neutral-400">{r.assignedTo?.name ?? '—'}</td>
                      <td className="p-4 text-neutral-400">{r.assignedAdvisor?.name ?? '—'}</td>
                      <td className="p-4 text-neutral-400">{r.assignedCaseAssessor?.name ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {totalPages > 1 && (
            <div className="flex items-center justify-between px-4 py-3 border-t border-neutral-800 text-xs text-neutral-500">
              <span>
                Showing {pageStart}–{pageEnd} of {total}
              </span>
              <div className="flex gap-2">
                <button
                  type="button"
                  disabled={currentPage === 1}
                  onClick={() => setCurrentPage((p) => p - 1)}
                  className="px-3 py-1.5 bg-neutral-800 rounded-md border border-neutral-700 disabled:opacity-30"
                >
                  Prev
                </button>
                <button
                  type="button"
                  disabled={currentPage === totalPages}
                  onClick={() => setCurrentPage((p) => p + 1)}
                  className="px-3 py-1.5 bg-neutral-800 rounded-md border border-neutral-700 disabled:opacity-30"
                >
                  Next
                </button>
              </div>
            </div>
          )}
        </div>
      </main>
    </div>
  )
}
