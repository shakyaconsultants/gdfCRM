'use client'

import { useState, useEffect, useMemo, useRef, useCallback } from 'react'
import Navigation from '@/components/Navigation'
import {
  Save,
  Loader2,
  ChevronDown,
  ChevronRight,
  Search,
  Filter,
  AlertTriangle,
  Users,
  CheckCircle,
  TrendingUp,
  ClipboardList,
} from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'
import { useRestrictCopy } from '@/hooks/useRestrictCopy'
import EmployeeIntakeFormEditor from '@/components/employee/EmployeeIntakeFormEditor'
import DispositionSelect from '@/components/employee/DispositionSelect'
import { parseEmployeeIntakeForm, type EmployeeIntakeForm } from '@/lib/employee-intake-form'
import { LEAD_DISPOSITIONS } from '@/lib/lead-workflow'
import { format, formatDistanceToNow } from 'date-fns'
import { useVisibilityPolling } from '@/hooks/useVisibilityPolling'
import { mergeLeadDeltas } from '@/lib/lead-sync-client'
import { LeadSaveQueue } from '@/lib/lead-save-queue'
import { MIN_LEAD_SEARCH_LENGTH } from '@/lib/lead-search-filter'

function formatLeadUpdated(iso: string | null | undefined) {
  if (!iso) return { relative: '—', full: '' }
  const d = new Date(iso)
  if (!Number.isFinite(d.getTime())) return { relative: '—', full: '' }
  return {
    relative: formatDistanceToNow(d, { addSuffix: true }),
    full: format(d, 'dd MMM yyyy, HH:mm'),
  }
}

type AdvisorOption = { id: string; name: string }

type Lead = {
  id: string
  title: string | null
  firstName: string | null
  lastName: string | null
  email: string | null
  address: string | null
  addressLine1: string | null
  addressLine2: string | null
  addressLine3: string | null
  addressLine4: string | null
  postCode: string | null
  phone: string
  disposition: string
  remarks: string | null
  moveToAdvisor: boolean
  assignedAdvisorId: string | null
  closedSale: boolean
  verifiedSale: boolean
  paymentReceived: boolean
  caseStatus?: string | null
  callbackAt: string | null
  updatedAt: string
}
const DISPOSITIONS = [...LEAD_DISPOSITIONS]

export default function EmployeeCrmPanel() {
  const [leads, setLeads] = useState<Lead[]>([])
  const [advisors, setAdvisors] = useState<AdvisorOption[]>([])
  const [loading, setLoading] = useState(true)
  const [totalLeads, setTotalLeads] = useState(0)
  const [totalPages, setTotalPages] = useState(1)
  const [kpiStats, setKpiStats] = useState({
    total: 0,
    dropped: 0,
    verified: 0,
    clawbacks: 0,
    referred: 0,
  })
  const [searchTerm, setSearchTerm] = useState('')
  const [filterDisposition, setFilterDisposition] = useState('All')
  const lastSyncRef = useRef<string | null>(null)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [savingId, setSavingId] = useState<string | null>(null)
  
  // Performance Optimization: Pagination & Debouncing
  const [currentPage, setCurrentPage] = useState(1)
  const pageSize = 50
  const [displaySearchTerm, setDisplaySearchTerm] = useState('')

  const saveQueueRef = useRef(new LeadSaveQueue())
  const [formDraft, setFormDraft] = useState<EmployeeIntakeForm | null>(null)
  const lastSavedFormJson = useRef('')
  const intakeModalOpenRef = useRef(false)
  intakeModalOpenRef.current = !!expandedId
  const restrictCopy = useRestrictCopy()

  const openIntakeModal = async (lead: Lead) => {
    setExpandedId(lead.id)
    try {
      const res = await fetch(`/api/employee/leads/${lead.id}`, { cache: 'no-store' })
      const data = await res.json()
      const parsed = parseEmployeeIntakeForm(data.lead?.employeeIntakeForm ?? null)
      const resolvedName = [lead.firstName, lead.lastName].filter(Boolean).join(' ').trim()
      if (!parsed.fullName && resolvedName) parsed.fullName = resolvedName
      if (!parsed.callingNumber && lead.phone) parsed.callingNumber = lead.phone
      if (!parsed.emailAddress && lead.email) parsed.emailAddress = lead.email
      if (parsed.whatsappSameAsCalling && !parsed.whatsappNumber && parsed.callingNumber) {
        parsed.whatsappNumber = parsed.callingNumber
      }
      setFormDraft(parsed)
      lastSavedFormJson.current = JSON.stringify(parsed)
    } catch {
      setFormDraft(parseEmployeeIntakeForm(null))
      lastSavedFormJson.current = JSON.stringify(parseEmployeeIntakeForm(null))
    }
  }

  const persistIntake = useCallback(async (leadId: string, form: EmployeeIntakeForm) => {
    setSavingId(leadId)
    try {
      const res = await fetch(`/api/employee/leads/${leadId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          employeeIntakeForm: form,
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (data.lead && res.ok) {
        setLeads((prev) =>
          prev.map((l) =>
            l.id === leadId
              ? { ...l, remarks: data.lead.remarks ?? l.remarks }
              : l
          )
        )
        lastSavedFormJson.current = JSON.stringify(form)
      }
    } finally {
      setSavingId(null)
    }
  }, [])

  useEffect(() => {
    if (!expandedId || !formDraft) return
    const snapshot = JSON.stringify(formDraft)
    if (snapshot === lastSavedFormJson.current) return
    const t = setTimeout(() => {
      void persistIntake(expandedId, formDraft)
    }, 1200)
    return () => clearTimeout(t)
  }, [expandedId, formDraft, persistIntake])

  useEffect(() => {
    if (!expandedId) setFormDraft(null)
  }, [expandedId])

  const buildLeadsQuery = useCallback(
    (opts?: { since?: string }) => {
      const params = new URLSearchParams()
      if (opts?.since) {
        params.set('since', opts.since)
      } else {
        params.set('page', String(currentPage))
        params.set('pageSize', String(pageSize))
        params.set('stats', 'true')
        if (searchTerm) params.set('search', searchTerm)
        if (filterDisposition !== 'All') params.set('disposition', filterDisposition)
      }
      return params.toString()
    },
    [currentPage, pageSize, searchTerm, filterDisposition]
  )

  const fetchLeads = useCallback(
    async (opts?: { silent?: boolean; poll?: boolean }) => {
      if (opts?.poll && intakeModalOpenRef.current) return
      if (!opts?.silent && !opts?.poll) setLoading(true)
      try {
        const qs = buildLeadsQuery(
          opts?.poll && lastSyncRef.current ? { since: lastSyncRef.current } : undefined
        )
        const [leadsRes, advRes] = await Promise.all([
          fetch(`/api/employee/leads?${qs}`, { cache: 'no-store' }),
          opts?.poll ? Promise.resolve(null) : fetch('/api/employee/advisors', { cache: 'no-store' }),
        ])
        const leadsData = await leadsRes.json()
        if (opts?.poll && leadsData.deltas) {
          const skipIds = saveQueueRef.current.pendingLeadIds()
          setLeads((prev) => mergeLeadDeltas(prev, leadsData.deltas as Lead[], { skipIds }))
          if (leadsData.serverTime) lastSyncRef.current = leadsData.serverTime
          return
        }
        if (leadsData.leads) setLeads(leadsData.leads)
        if (typeof leadsData.total === 'number') setTotalLeads(leadsData.total)
        if (typeof leadsData.totalPages === 'number') setTotalPages(leadsData.totalPages)
        if (leadsData.stats) setKpiStats(leadsData.stats)
        if (leadsData.serverTime) lastSyncRef.current = leadsData.serverTime
        if (advRes) {
          const advData = await advRes.json()
          if (advData.advisors) setAdvisors(advData.advisors)
        }
      } finally {
        if (!opts?.silent && !opts?.poll) setLoading(false)
      }
    },
    [buildLeadsQuery]
  )

  useEffect(() => {
    void fetchLeads()
  }, [fetchLeads])

  useVisibilityPolling(
    () => fetchLeads({ silent: true, poll: true }),
    [fetchLeads],
    { intervalMs: 120_000 }
  )

  // Debounce search term update
  useEffect(() => {
    const timer = setTimeout(() => {
      const q = displaySearchTerm.trim()
      setSearchTerm(q.length === 0 || q.length >= MIN_LEAD_SEARCH_LENGTH ? q : '')
      setCurrentPage(1)
    }, 300)
    return () => clearTimeout(timer)
  }, [displaySearchTerm])

  const paginatedLeads = leads
  const pageStart = totalLeads === 0 ? 0 : (currentPage - 1) * pageSize + 1
  const pageEnd = Math.min(currentPage * pageSize, totalLeads)

  const toLocalDatetimeInput = (iso: string | null) => {
    if (!iso) return ''
    const dt = new Date(iso)
    if (!Number.isFinite(dt.getTime())) return ''
    const pad = (n: number) => String(n).padStart(2, '0')
    return `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}T${pad(dt.getHours())}:${pad(dt.getMinutes())}`
  }

  const fromLocalDatetimeInput = (value: string) => {
    if (!value) return null
    const dt = new Date(value)
    if (!Number.isFinite(dt.getTime())) return null
    return dt.toISOString()
  }

  const saveLeadPatch = useCallback(
    async (leadId: string, body: Record<string, unknown>) => {
      setSavingId(leadId)
      try {
        const res = await fetch(`/api/employee/leads/${leadId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        })
        const data = await res.json().catch(() => ({}))
        if (res.ok && data.lead) {
          setLeads((prev) =>
            prev.map((l) =>
              l.id === leadId
                ? {
                    ...l,
                    disposition: data.lead.disposition ?? l.disposition,
                    remarks: data.lead.remarks ?? l.remarks,
                    moveToAdvisor: data.lead.moveToAdvisor ?? l.moveToAdvisor,
                    assignedAdvisorId: data.lead.assignedAdvisorId ?? l.assignedAdvisorId,
                    callbackAt:
                      data.lead.callbackAt !== undefined
                        ? data.lead.callbackAt
                        : l.callbackAt,
                    updatedAt:
                      typeof data.lead.updatedAt === 'string'
                        ? data.lead.updatedAt
                        : l.updatedAt,
                  }
                : l
            )
          )
        }
        return { ok: res.ok, status: res.status, data }
      } finally {
        setSavingId((current) => (current === leadId ? null : current))
      }
    },
    []
  )

  const updateLead = (id: string, updates: Partial<Lead>, immediate = false) => {
    setLeads((prev) =>
      prev.map((l) =>
        l.id === id ? { ...l, ...updates, updatedAt: new Date().toISOString() } : l
      )
    )

    const body = updates as Record<string, unknown>
    if (immediate) {
      void saveQueueRef.current.enqueueNow(id, body, saveLeadPatch)
    } else {
      saveQueueRef.current.schedule(id, body, saveLeadPatch, 1000)
    }
  }
  
  const forceSaveIntake = () => {
    if (!expandedId || !formDraft) return
    void persistIntake(expandedId, formDraft)
  }

  useEffect(() => {
    if (typeof window === 'undefined') return
    if (!('Notification' in window)) return
    const notify = () => {
      const now = Date.now()
      paginatedLeads.forEach((lead) => {
        if (!lead.callbackAt) return
        const callbackTs = new Date(lead.callbackAt).getTime()
        const reminderAt = callbackTs - 15 * 60 * 1000
        if (now < reminderAt || now > callbackTs) return
        const key = `cb-reminded:${lead.id}:${lead.callbackAt}`
        if (localStorage.getItem(key)) return
        localStorage.setItem(key, '1')
        if (Notification.permission === 'granted') {
          new Notification('Callback reminder (15 min)', {
            body: `${lead.firstName || ''} ${lead.lastName || ''} · ${lead.phone}`.trim(),
          })
        }
      })
    }

    if (Notification.permission === 'default') void Notification.requestPermission()
    notify()
    const id = setInterval(notify, 120 * 1000)
    return () => clearInterval(id)
  }, [paginatedLeads])

  const closeIntakeModal = () => setExpandedId(null)

  const intakeHasData = (lead: Lead) => !!lead.remarks?.trim()

  return (
    <div
      className="h-screen flex flex-col overflow-hidden bg-neutral-950 text-neutral-200 select-none"
      {...restrictCopy}
    >
      <Navigation />
      
      <main className="flex-1 min-h-0 flex flex-col w-full max-w-[1600px] mx-auto px-4 sm:px-6 lg:px-8 py-4 sm:py-6">
        <div className="shrink-0 flex flex-col lg:flex-row lg:items-center justify-between gap-4 mb-4">
          <div>
            <h1 className="text-2xl font-bold text-white">CRM · Assigned leads</h1>
            <p className="text-neutral-400 text-sm mt-1">Calling data, intake forms, and advisor escalation.</p>
          </div>
          
          <div className="flex flex-col sm:flex-row items-center gap-4">
            <div className="relative w-full sm:w-64">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-neutral-500" />
              <input 
                type="text" 
                placeholder="Search my leads..."
                value={displaySearchTerm}
                onChange={e => setDisplaySearchTerm(e.target.value)}
                className="w-full bg-neutral-900 border border-neutral-800 rounded-lg pl-10 pr-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/50 transition-all text-white select-text"
              />
            </div>

            <div className="relative w-full sm:w-48">
              <Filter className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-neutral-500" />
              <select 
                value={filterDisposition}
                onChange={e => setFilterDisposition(e.target.value)}
                className="w-full bg-neutral-900 border border-neutral-800 text-white rounded-lg pl-10 pr-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/50 appearance-none transition-all select-text"
              >
                <option value="All" className="bg-neutral-900 text-white">All Dispositions</option>
                {DISPOSITIONS.map(d => (
                  <option key={d} value={d} className="bg-neutral-900 text-white">
                    {d}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>

        {/* KPI Stats Banner */}
        <div className="shrink-0 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 mb-4">
          {[
            {
              label: 'Total Assigned',
              value: kpiStats.total,
              icon: Users,
              color: 'text-blue-500',
              bg: 'bg-blue-500/10',
            },
            {
              label: 'Dropped',
              value: kpiStats.dropped,
              icon: TrendingUp,
              color: 'text-amber-500',
              bg: 'bg-amber-500/10',
            },
            {
              label: 'Verified',
              value: kpiStats.verified,
              icon: CheckCircle,
              color: 'text-emerald-500',
              bg: 'bg-emerald-500/10',
            },
            {
              label: 'Clawbacks',
              value: kpiStats.clawbacks,
              icon: AlertTriangle,
              color: 'text-rose-500',
              bg: 'bg-rose-500/10',
            },
            {
              label: 'Referred to Advisor',
              value: kpiStats.referred,
              icon: AlertTriangle,
              color: 'text-blue-500',
              bg: 'bg-blue-500/10',
            },
          ].map((stat, i) => {
            const Icon = stat.icon
            return (
              <motion.div
                key={stat.label}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.1 }}
                className="bg-neutral-900 border border-neutral-800 rounded-2xl p-4 flex items-center gap-3 group hover:border-neutral-700 transition-colors"
              >
                <div className={`p-3 rounded-xl ${stat.bg} ${stat.color}`}>
                  <Icon className="w-6 h-6" />
                </div>
                <div>
                  <p className="text-2xl font-bold text-white leading-none">{stat.value}</p>
                  <p className="text-xs font-medium text-neutral-500 uppercase tracking-widest mt-1.5">{stat.label}</p>
                </div>
              </motion.div>
            )
          })}
        </div>

        <div className="flex-1 min-h-0 flex flex-col bg-neutral-900/50 border border-neutral-800 rounded-2xl backdrop-blur-sm shadow-xl overflow-hidden">
          <div className="shrink-0 px-4 py-2 border-b border-neutral-800/80 flex items-center justify-between gap-2 text-[11px] text-neutral-500">
            <span>{totalLeads} lead{totalLeads === 1 ? '' : 's'} · scroll horizontally for all columns</span>
            {loading && <Loader2 className="w-3.5 h-3.5 animate-spin text-blue-400" aria-hidden />}
          </div>
          <div className="flex-1 min-h-0 overflow-auto overscroll-x-contain">
            <table className="min-w-max w-full text-left border-collapse text-sm">
              <thead className="sticky top-0 z-10 shadow-[0_1px_0_0_rgb(38,38,38)]">
                <tr className="border-b border-neutral-800 bg-neutral-900 text-[10px] uppercase tracking-wider text-neutral-400">
                  <th className="p-3 w-10 sticky left-0 z-20 bg-neutral-900"></th>
                  <th className="p-3 font-medium whitespace-nowrap">Title</th>
                  <th className="p-3 font-medium whitespace-nowrap">First name</th>
                  <th className="p-3 font-medium whitespace-nowrap">Last name</th>
                  <th className="p-3 font-medium min-w-[10rem]">Address</th>
                  <th className="p-3 font-medium whitespace-nowrap">Post code</th>
                  <th className="p-3 font-medium whitespace-nowrap">Phone</th>
                  <th className="p-3 font-medium whitespace-nowrap">Email</th>
                  <th className="p-3 font-medium min-w-[9rem]">Disposition</th>
                  <th className="p-3 font-medium whitespace-nowrap min-w-[7rem]">Updated</th>
                  <th className="p-3 font-medium min-w-[11rem]">Callback</th>
                  <th className="p-3 font-medium text-center whitespace-nowrap">Intake</th>
                  <th className="p-3 font-medium min-w-[10rem]">Advisor</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-800/50">
                {loading ? (
                   <tr>
                     <td colSpan={13} className="p-10 text-center text-neutral-500">
                        <Loader2 className="w-6 h-6 animate-spin mx-auto mb-2" />
                        Loading assigned leads...
                     </td>
                   </tr>
                ) : paginatedLeads.length === 0 ? (
                  <tr>
                    <td colSpan={13} className="p-10 text-center text-neutral-500">
                      No leads match your search or filter.
                    </td>
                  </tr>
                ) : (
                  paginatedLeads.map(lead => {
                    const updated = formatLeadUpdated(lead.updatedAt)
                    return (
                    <motion.tr 
                      key={lead.id}
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      className={`hover:bg-neutral-800/40 transition-colors ${expandedId === lead.id ? 'bg-blue-950/20' : ''}`}
                    >
                      <td className="p-3 text-center sticky left-0 z-[1] bg-neutral-900/95">
                        <button
                          type="button"
                          onClick={() =>
                            expandedId === lead.id ? closeIntakeModal() : openIntakeModal(lead)
                          }
                          className="text-neutral-500 hover:text-white transition-colors"
                          aria-expanded={expandedId === lead.id}
                        >
                          {expandedId === lead.id ? (
                            <ChevronDown className="w-4 h-4" aria-hidden />
                          ) : (
                            <ChevronRight className="w-4 h-4" aria-hidden />
                          )}
                        </button>
                      </td>
                      <td className="p-3 text-neutral-300 whitespace-nowrap">{lead.title || '—'}</td>
                      <td className="p-3 font-medium text-white whitespace-nowrap">{lead.firstName || '—'}</td>
                      <td className="p-3 text-neutral-300 whitespace-nowrap">{lead.lastName || '—'}</td>
                      <td className="p-3 text-neutral-400 min-w-[10rem] max-w-[18rem] whitespace-normal break-words align-top select-text" title={lead.address || ''}>{lead.address || '—'}</td>
                      <td className="p-3 text-neutral-400 whitespace-nowrap">{lead.postCode || '—'}</td>
                      <td className="p-3 font-mono text-neutral-300 whitespace-nowrap">
                        <a href={`tel:${lead.phone}`} className="hover:text-blue-400 underline decoration-neutral-700 underline-offset-4 select-text">{lead.phone}</a>
                      </td>
                      <td className="p-3 text-neutral-300 normal-case max-w-[14rem] truncate select-text" title={lead.email || ''}>{lead.email || '—'}</td>
                      <td className="p-3 align-top">
                        <DispositionSelect
                          value={lead.disposition}
                          options={DISPOSITIONS}
                          onSelect={(nextDisposition) => {
                            const updates: Partial<Lead> = { disposition: nextDisposition }
                            if (nextDisposition !== 'Callback') {
                              updates.callbackAt = null
                            }
                            updateLead(lead.id, updates, true)
                          }}
                        />
                      </td>
                      <td className="p-3 align-top whitespace-nowrap select-text" title={updated.full}>
                        <span className="text-[11px] text-neutral-400 block">{updated.relative}</span>
                        {updated.full ? (
                          <span className="text-[10px] text-neutral-600 block mt-0.5">{updated.full}</span>
                        ) : null}
                      </td>
                      <td className="p-3 min-w-[11rem] align-top">
                        {lead.disposition === 'Callback' ? (
                          <div className="flex items-center gap-2">
                            <input
                              type="datetime-local"
                              value={toLocalDatetimeInput(lead.callbackAt)}
                              onFocus={() => {
                                if (typeof window !== 'undefined' && 'Notification' in window && Notification.permission === 'default') {
                                  void Notification.requestPermission()
                                }
                              }}
                              onChange={(e) => {
                                const nextIso = fromLocalDatetimeInput(e.target.value)
                                updateLead(lead.id, { callbackAt: nextIso }, true)
                              }}
                              className="w-full bg-neutral-800 border border-neutral-700 rounded-md px-2 py-1 text-[11px] text-white focus:outline-none focus:ring-1 focus:ring-blue-500"
                            />
                          </div>
                        ) : (
                          <span className="text-[10px] text-neutral-600 leading-snug">Set disposition to Callback</span>
                        )}
                      </td>
                      <td className="p-3 text-center align-top">
                        <button
                          type="button"
                          onClick={() =>
                            expandedId === lead.id ? closeIntakeModal() : openIntakeModal(lead)
                          }
                          className={`transition-colors ${intakeHasData(lead) ? 'text-blue-400' : 'text-neutral-500 hover:text-blue-400'}`}
                          title="Open intake form"
                        >
                          <ClipboardList className="w-4 h-4 inline" aria-hidden />
                        </button>
                      </td>
                      <td className="p-3 min-w-[10rem] align-top">
                        <select
                          value={lead.assignedAdvisorId ?? ''}
                          onChange={(e) => {
                            const v = e.target.value
                            updateLead(
                              lead.id,
                              {
                                assignedAdvisorId: v ? v : null,
                                moveToAdvisor: !!v,
                              },
                              true
                            )
                          }}
                          className="w-full min-w-[9rem] bg-neutral-800 border border-neutral-700 rounded-md px-2 py-1.5 text-[11px] font-medium text-white focus:outline-none focus:ring-1 focus:ring-amber-500 select-text"
                        >
                          <option value="">— Advisor —</option>
                          {advisors.map((a) => (
                            <option key={a.id} value={a.id}>
                              {a.name}
                            </option>
                          ))}
                        </select>
                      </td>
                    </motion.tr>
                    )
                  })
                )}
              </tbody>
            </table>
          </div>

          {/* Pagination Controls */}
          <div className="shrink-0 bg-neutral-900/80 border-t border-neutral-800 px-4 py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div className="text-xs text-neutral-500">
                {totalLeads === 0
                  ? 'No leads'
                  : `Showing ${pageStart}–${pageEnd} of ${totalLeads}`}
                {totalPages > 1 && ` · page ${currentPage} of ${totalPages}`}
              </div>
          {totalPages > 1 && (
              <div className="flex items-center gap-2 sm:ml-auto">
                <button
                  disabled={currentPage === 1}
                  onClick={() => setCurrentPage((prev) => prev - 1)}
                  className="px-3 py-1.5 bg-neutral-800 hover:bg-neutral-700 disabled:opacity-30 rounded-md text-xs transition-colors border border-neutral-700 font-medium text-white"
                >
                  Prev
                </button>
                <button
                  disabled={currentPage === totalPages}
                  onClick={() => setCurrentPage((prev) => prev + 1)}
                  className="px-3 py-1.5 bg-neutral-800 hover:bg-neutral-700 disabled:opacity-30 rounded-md text-xs transition-colors border border-neutral-700 font-medium text-white"
                >
                  Next
                </button>
              </div>
          )}
          </div>
        </div>

        {/* Employee intake modal */}
        <AnimatePresence>
          {expandedId && formDraft && (
            <div
              className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
              role="presentation"
              onMouseDown={(e) => {
                if (e.target === e.currentTarget) closeIntakeModal()
              }}
            >
              <motion.div
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.95 }}
                className="w-full max-w-2xl max-h-[92vh] overflow-y-auto rounded-2xl border border-neutral-800 bg-neutral-900 shadow-2xl p-6"
                onMouseDown={(e) => e.stopPropagation()}
              >
                <div className="flex justify-between items-start mb-6 gap-3">
                  <div>
                    <h3 className="text-lg font-bold text-white flex items-center gap-2">
                      <ClipboardList className="w-5 h-5 text-blue-500" aria-hidden /> Lead intake
                    </h3>
                    <p className="text-xs text-neutral-500 mt-1 font-mono">
                      {(() => {
                        const l = leads.find((x) => x.id === expandedId)
                        return l
                          ? [l.firstName, l.lastName].filter(Boolean).join(' ') + ' · ' + l.phone
                          : ''
                      })()}
                    </p>
                  </div>
                  <div className="flex items-center gap-3 shrink-0">
                    {savingId === expandedId && (
                      <span className="text-xs text-blue-400 flex items-center gap-1">
                        <Loader2 className="w-3 h-3 animate-spin" aria-hidden /> Saving…
                      </span>
                    )}
                    <button
                      type="button"
                      onClick={closeIntakeModal}
                      className="text-neutral-500 hover:text-white w-9 h-9 flex items-center justify-center rounded-lg hover:bg-neutral-800 bg-neutral-950 border border-neutral-800"
                      aria-label="Close"
                    >
                      ×
                    </button>
                  </div>
                </div>

                <EmployeeIntakeFormEditor form={formDraft} setForm={setFormDraft} />

                <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 mt-6 pt-4 border-t border-neutral-800">
                  <span className="text-[10px] text-neutral-500">
                    Changes save automatically after about 1s without edits.
                  </span>
                  <button
                    type="button"
                    onClick={forceSaveIntake}
                    disabled={savingId === expandedId}
                    className="bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white px-4 py-2 rounded-lg text-xs font-bold transition-all inline-flex items-center gap-2"
                  >
                    <Save className="w-3.5 h-3.5" aria-hidden /> Save now
                  </button>
                </div>
              </motion.div>
            </div>
          )}
        </AnimatePresence>
      </main>
    </div>
  )
}
