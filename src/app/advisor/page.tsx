'use client'

import { useState, useEffect, useMemo, useRef, useCallback } from 'react'
import Navigation from '@/components/Navigation'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Briefcase,
  ArrowRightLeft,
  CheckCircle2,
  ShieldAlert,
  UserCheck,
  UserX,
  Loader2,
  ChevronDown,
  ChevronRight,
  MessageSquare,
  Search,
  Save,
  FolderOpen,
  Download,
  Trash2,
  Upload,
  X,
} from 'lucide-react'
import { useRestrictCopy } from '@/hooks/useRestrictCopy'
import { useVisibilityPolling } from '@/hooks/useVisibilityPolling'
import { parseEmployeeIntakeForm, type EmployeeIntakeForm } from '@/lib/employee-intake-form'
import EmployeeIntakeFormEditor from '@/components/employee/EmployeeIntakeFormEditor'
import { mergeLeadDeltas } from '@/lib/lead-sync-client'

type CaseAssessorOption = { id: string; name: string }

type Lead = {
  id: string
  firstName: string | null
  lastName: string | null
  email: string | null
  addressLine1: string | null
  addressLine2: string | null
  addressLine3: string | null
  addressLine4: string | null
  phone: string
  assignedTo: { name: string } | null
  remarks: string | null
  closedSale: boolean
  verifiedSale: boolean
  caseStatus: string | null
  assignedCaseAssessorId: string | null
  preSipAt: string | null
  updatedAt: string
  _count?: { documents: number }
}

type LeadDocumentRow = {
  id: string
  fileName: string
  url: string
  publicId: string
  resourceType: string
  mimeType: string | null
  createdAt: string
}

async function errorMessageFromResponse(res: Response): Promise<string> {
  if (res.status === 413) {
    return 'File is too large. Vercel allows about 4.5 MB per upload; try a smaller or compressed file.'
  }
  try {
    const j = (await res.json()) as { error?: string }
    if (j.error) return j.error
  } catch {
    // ignore
  }
  return res.statusText || 'Request failed'
}

export default function AdminAdvisorPage() {
  const [leads, setLeads] = useState<Lead[]>([])
  const [assessors, setAssessors] = useState<CaseAssessorOption[]>([])
  const [loading, setLoading] = useState(true)
  const [fetchWarning, setFetchWarning] = useState<string | null>(null)
  const [searchTerm, setSearchTerm] = useState('')
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [documentsLeadId, setDocumentsLeadId] = useState<string | null>(null)
  const [documentsList, setDocumentsList] = useState<LeadDocumentRow[]>([])
  const [documentsLoading, setDocumentsLoading] = useState(false)
  const [documentUploading, setDocumentUploading] = useState(false)
  const [documentDeletingId, setDocumentDeletingId] = useState<string | null>(null)
  const [documentError, setDocumentError] = useState<string | null>(null)
  const docFileInputRef = useRef<HTMLInputElement | null>(null)
  const replaceTargetDocIdRef = useRef<string | null>(null)

  const [currentPage, setCurrentPage] = useState(1)
  const [totalLeads, setTotalLeads] = useState(0)
  const [totalPages, setTotalPages] = useState(1)
  const pageSize = 50
  const [displaySearchTerm, setDisplaySearchTerm] = useState('')
  const [advisorStats, setAdvisorStats] = useState({
    transferredFromEmployee: 0,
    dropped: 0,
    forwardedToCaseAssessor: 0,
    verified: 0,
    clawback: 0,
  })
  const lastSyncRef = useRef<string | null>(null)

  const timeoutRef = useRef<NodeJS.Timeout | null>(null)
  const [intakeDraft, setIntakeDraft] = useState<EmployeeIntakeForm | null>(null)
  const lastSavedIntake = useRef('')
  const restrictCopy = useRestrictCopy()

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
      }
      return params.toString()
    },
    [currentPage, pageSize, searchTerm]
  )

  const fetchData = useCallback(
    async (opts?: { poll?: boolean }) => {
      try {
        const qs = buildLeadsQuery(
          opts?.poll && lastSyncRef.current ? { since: lastSyncRef.current } : undefined
        )
        const [leadsRes, assessorRes] = await Promise.all([
          fetch(`/api/advisor/leads?${qs}`, { cache: 'no-store' }),
          opts?.poll ? Promise.resolve(null) : fetch('/api/advisor/case-assessors', { cache: 'no-store' }),
        ])
        const leadsData = await leadsRes.json().catch(() => ({}))

        if (opts?.poll && leadsData.deltas) {
          setLeads((prev) => mergeLeadDeltas(prev, leadsData.deltas))
          if (leadsData.serverTime) lastSyncRef.current = leadsData.serverTime
          return
        }

        const problems: string[] = []
        if (leadsRes.ok && Array.isArray(leadsData.leads)) {
          setLeads(leadsData.leads)
          if (typeof leadsData.total === 'number') setTotalLeads(leadsData.total)
          if (typeof leadsData.totalPages === 'number') setTotalPages(leadsData.totalPages)
          if (leadsData.stats) setAdvisorStats(leadsData.stats)
          if (leadsData.serverTime) lastSyncRef.current = leadsData.serverTime
        } else problems.push('leads')

        if (assessorRes) {
          const assessorData = await assessorRes.json().catch(() => ({}))
          if (assessorRes.ok && Array.isArray(assessorData.assessors)) setAssessors(assessorData.assessors)
          else problems.push('case assessors')
        }

        if (problems.length > 0) {
          setFetchWarning(`Temporary connection issue while loading ${problems.join(' and ')}. Retrying automatically.`)
        } else {
          setFetchWarning(null)
        }
      } catch (error) {
        console.error('Advisor fetchData failed:', error)
        setFetchWarning('Temporary network issue while loading advisor data. Retrying automatically.')
      } finally {
        if (!opts?.poll) setLoading(false)
      }
    },
    [buildLeadsQuery]
  )

  useEffect(() => {
    setLoading(true)
    void fetchData()
  }, [fetchData])

  useVisibilityPolling(() => fetchData({ poll: true }), [fetchData], { intervalMs: 120_000 })

  useEffect(() => {
    const timer = setTimeout(() => {
      setSearchTerm(displaySearchTerm)
      setCurrentPage(1)
    }, 300)
    return () => clearTimeout(timer)
  }, [displaySearchTerm])

  const paginatedLeads = leads
  const pageStart = totalLeads === 0 ? 0 : (currentPage - 1) * pageSize + 1
  const pageEnd = Math.min(currentPage * pageSize, totalLeads)

  const updateLead = async (id: string, updates: Partial<Lead>, immediate = false) => {
    setLeads((prev) => prev.map((l) => (l.id === id ? { ...l, ...updates } : l)))

    if (timeoutRef.current) clearTimeout(timeoutRef.current)

    const performSave = async () => {
      await fetch(`/api/advisor/leads/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates),
      })
    }

    if (immediate) {
      performSave()
    } else {
      timeoutRef.current = setTimeout(performSave, 1000)
    }
  }

  const expandedLead = expandedId ? leads.find((l) => l.id === expandedId) : null

  useEffect(() => {
    if (!expandedId) {
      setIntakeDraft(null)
      return
    }
    const lead = leads.find((l) => l.id === expandedId)
    if (!lead) return
    void (async () => {
      try {
        const res = await fetch(`/api/advisor/leads/${expandedId}`, { cache: 'no-store' })
        const data = await res.json()
        const parsed = parseEmployeeIntakeForm(data.lead?.employeeIntakeForm ?? null)
        const resolvedName = [lead.firstName, lead.lastName].filter(Boolean).join(' ').trim()
        if (!parsed.fullName && resolvedName) parsed.fullName = resolvedName
        if (!parsed.callingNumber && lead.phone) parsed.callingNumber = lead.phone
        if (!parsed.emailAddress && lead.email) parsed.emailAddress = lead.email
        if (parsed.whatsappSameAsCalling && !parsed.whatsappNumber && parsed.callingNumber) {
          parsed.whatsappNumber = parsed.callingNumber
        }
        setIntakeDraft(parsed)
        lastSavedIntake.current = JSON.stringify(parsed)
      } catch {
        setIntakeDraft(parseEmployeeIntakeForm(null))
      }
    })()
  }, [expandedId, leads])

  const persistIntake = useCallback(async () => {
    if (!expandedId || !intakeDraft) return
    await updateLead(expandedId, { employeeIntakeForm: intakeDraft } as Partial<Lead>, true)
    lastSavedIntake.current = JSON.stringify(intakeDraft)
  }, [expandedId, intakeDraft])

  useEffect(() => {
    if (!expandedId || !intakeDraft) return
    const current = JSON.stringify(intakeDraft)
    if (current === lastSavedIntake.current) return
    const t = setTimeout(() => {
      void persistIntake()
    }, 1200)
    return () => clearTimeout(t)
  }, [expandedId, intakeDraft, persistIntake])

  const refreshLeads = async () => {
    await fetchData()
  }

  const loadDocumentsForLead = async (leadId: string) => {
    setDocumentsLoading(true)
    try {
      const res = await fetch(`/api/advisor/leads/${leadId}/documents`)
      const data = await res.json()
      if (data.documents) setDocumentsList(data.documents)
    } finally {
      setDocumentsLoading(false)
    }
  }

  const openDocumentsModal = (leadId: string) => {
    setDocumentError(null)
    setDocumentsLeadId(leadId)
    setDocumentsList([])
    void loadDocumentsForLead(leadId)
  }

  const closeDocumentsModal = () => {
    setDocumentsLeadId(null)
    setDocumentsList([])
    setDocumentError(null)
    replaceTargetDocIdRef.current = null
  }

  const uploadDocument = async (file: File) => {
    if (!documentsLeadId) return
    setDocumentUploading(true)
    setDocumentError(null)
    try {
      const fd = new FormData()
      fd.append('file', file)
      const res = await fetch(`/api/advisor/leads/${documentsLeadId}/documents`, {
        method: 'POST',
        body: fd,
      })
      if (!res.ok) {
        setDocumentError(await errorMessageFromResponse(res))
        return
      }
      setDocumentError(null)
      await loadDocumentsForLead(documentsLeadId)
      await refreshLeads()
    } finally {
      setDocumentUploading(false)
    }
  }

  const deleteDocument = async (docId: string) => {
    if (!documentsLeadId) return
    setDocumentDeletingId(docId)
    setDocumentError(null)
    try {
      const res = await fetch(
        `/api/advisor/leads/${documentsLeadId}/documents/${docId}`,
        { method: 'DELETE' }
      )
      if (!res.ok) {
        setDocumentError(await errorMessageFromResponse(res))
        return
      }
      await loadDocumentsForLead(documentsLeadId)
      await refreshLeads()
    } finally {
      setDocumentDeletingId(null)
    }
  }

  const replaceDocument = async (oldDocId: string, file: File) => {
    if (!documentsLeadId) return
    setDocumentUploading(true)
    setDocumentError(null)
    try {
      const fd = new FormData()
      fd.append('file', file)
      const postRes = await fetch(`/api/advisor/leads/${documentsLeadId}/documents`, {
        method: 'POST',
        body: fd,
      })
      if (!postRes.ok) {
        setDocumentError(await errorMessageFromResponse(postRes))
        return
      }
      const delRes = await fetch(
        `/api/advisor/leads/${documentsLeadId}/documents/${oldDocId}`,
        { method: 'DELETE' }
      )
      if (!delRes.ok) {
        setDocumentError(await errorMessageFromResponse(delRes))
        await loadDocumentsForLead(documentsLeadId)
        await refreshLeads()
        return
      }
      await loadDocumentsForLead(documentsLeadId)
      await refreshLeads()
    } finally {
      setDocumentUploading(false)
      replaceTargetDocIdRef.current = null
    }
  }

  const startAddDocument = () => {
    replaceTargetDocIdRef.current = null
    docFileInputRef.current?.click()
  }

  const startReplaceDocument = (docId: string) => {
    replaceTargetDocIdRef.current = docId
    docFileInputRef.current?.click()
  }

  const onDocumentFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    const replaceId = replaceTargetDocIdRef.current
    replaceTargetDocIdRef.current = null
    if (replaceId) await replaceDocument(replaceId, file)
    else await uploadDocument(file)
  }

  const leadForDocuments = documentsLeadId
    ? leads.find((l) => l.id === documentsLeadId)
    : null
  const leadDocLabel = leadForDocuments
    ? [leadForDocuments.firstName, leadForDocuments.lastName].filter(Boolean).join(' ') ||
      leadForDocuments.phone
    : ''

  return (
    <div
      className="min-h-screen bg-neutral-950 text-neutral-200 select-none"
      {...restrictCopy}
    >
      <Navigation />

      <main className="max-w-[1600px] mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between mb-8 gap-6">
          <div>
            <h1 className="text-2xl font-bold text-white flex items-center gap-2">
              <Briefcase className="w-6 h-6 text-amber-500" /> Advisor Desk
            </h1>
            <p className="text-neutral-400 text-sm mt-1">Manage leads transferred from employees and drive case outcomes.</p>
          </div>

          <div className="relative w-full sm:w-64">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-neutral-500" />
            <input
              type="text"
              placeholder="Search leads..."
              value={displaySearchTerm}
              onChange={(e) => setDisplaySearchTerm(e.target.value)}
              className="w-full bg-neutral-900 border border-neutral-800 rounded-lg pl-10 pr-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/50 transition-all text-white select-text"
            />
          </div>
        </div>

        {fetchWarning ? (
          <div className="mb-4 rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-xs text-amber-300">
            {fetchWarning}
          </div>
        ) : null}

        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-5 gap-4 mb-6">
          {[
            {
              label: 'Transferred from employee',
              value: advisorStats.transferredFromEmployee,
              icon: ArrowRightLeft,
              color: 'text-cyan-400',
              bg: 'bg-cyan-500/10',
            },
            {
              label: 'Dropped',
              value: advisorStats.dropped,
              icon: UserX,
              color: 'text-amber-400',
              bg: 'bg-amber-500/10',
            },
            {
              label: 'Forwarded to case assessor',
              value: advisorStats.forwardedToCaseAssessor,
              icon: UserCheck,
              color: 'text-indigo-400',
              bg: 'bg-indigo-500/10',
            },
            {
              label: 'Verified',
              value: advisorStats.verified,
              icon: CheckCircle2,
              color: 'text-emerald-400',
              bg: 'bg-emerald-500/10',
            },
            {
              label: 'Clawback',
              value: advisorStats.clawback,
              icon: ShieldAlert,
              color: 'text-rose-400',
              bg: 'bg-rose-500/10',
            },
          ].map((stat) => {
            const Icon = stat.icon
            return (
              <div
                key={stat.label}
                className="bg-neutral-900 border border-neutral-800 rounded-2xl p-4 flex items-center gap-3"
              >
                <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${stat.bg}`}>
                  <Icon className={`w-5 h-5 ${stat.color}`} />
                </div>
                <div>
                  <p className="text-xl font-bold text-white leading-none">{stat.value}</p>
                  <p className="text-[11px] uppercase tracking-wide text-neutral-500 mt-1">{stat.label}</p>
                </div>
              </div>
            )
          })}
        </div>

        <div className="bg-neutral-900/50 border border-neutral-800 rounded-2xl overflow-hidden backdrop-blur-sm shadow-xl">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-sm">
              <thead>
                <tr className="border-b border-neutral-800 bg-neutral-900/80 text-xs uppercase tracking-wider text-neutral-400">
                  <th className="p-4 w-10"></th>
                  <th className="p-4 font-medium">First Name</th>
                  <th className="p-4 font-medium">Last Name</th>
                  <th className="p-4 font-medium">Phone Number</th>
                  <th className="p-4 font-medium text-center">Assigned To</th>
                  <th className="p-4 font-medium text-center">Intake / Notes</th>
                  <th className="p-4 font-medium text-center">Documents</th>
                  <th className="p-4 font-medium text-center">Drop</th>
                  <th className="p-4 font-medium min-w-[180px]">Assign case assessor</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-800/50">
                {loading ? (
                  <tr>
                    <td colSpan={9} className="p-8 text-center text-neutral-500">
                      <Loader2 className="w-6 h-6 animate-spin mx-auto mb-2" />
                      Loading leads...
                    </td>
                  </tr>
                ) : paginatedLeads.length === 0 ? (
                  <tr>
                    <td colSpan={9} className="p-8 text-center text-neutral-500">
                      No leads found.
                    </td>
                  </tr>
                ) : (
                  paginatedLeads.map((lead) => (
                    <motion.tr
                      key={lead.id}
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      className={`hover:bg-neutral-800/30 transition-colors ${expandedId === lead.id ? 'bg-neutral-800/20' : ''}`}
                    >
                      <td className="p-4 text-center">
                        <button
                          type="button"
                          onClick={() => setExpandedId(expandedId === lead.id ? null : lead.id)}
                          className="text-neutral-500 hover:text-white transition-colors"
                        >
                          {expandedId === lead.id ? (
                            <ChevronDown className="w-4 h-4" />
                          ) : (
                            <ChevronRight className="w-4 h-4" />
                          )}
                        </button>
                      </td>
                      <td className="p-4 font-bold text-white">{lead.firstName}</td>
                      <td className="p-4 font-bold text-white">{lead.lastName || '-'}</td>
                      <td className="p-4 font-mono text-neutral-300">
                        <a
                          href={`tel:${lead.phone}`}
                          className="hover:text-blue-400 underline decoration-neutral-700 underline-offset-4"
                        >
                          {lead.phone}
                        </a>
                      </td>
                      <td className="p-4 text-center text-neutral-400 font-medium">
                        {lead.assignedTo?.name || '-'}
                      </td>
                      <td className="p-4 text-center">
                        <button
                          type="button"
                          onClick={() => setExpandedId(expandedId === lead.id ? null : lead.id)}
                          className="text-neutral-500 hover:text-blue-400 transition-colors"
                        >
                          <MessageSquare className="w-4 h-4 inline" />
                        </button>
                      </td>
                      <td className="p-4 text-center">
                        <button
                          type="button"
                          onClick={() => openDocumentsModal(lead.id)}
                          className="inline-flex items-center gap-1.5 px-2 py-1 rounded-lg border border-neutral-700 bg-neutral-800/80 hover:bg-neutral-800 text-[11px] font-bold text-neutral-200 transition-colors"
                          title="Manage documents"
                        >
                          <FolderOpen className="w-3.5 h-3.5 text-amber-500" />
                          <span className="tabular-nums text-neutral-400">
                            {lead._count?.documents ?? 0}
                          </span>
                        </button>
                      </td>
                      <td className="p-4 text-center">
                        <input
                          type="checkbox"
                          checked={lead.closedSale}
                          onChange={(e) => updateLead(lead.id, { closedSale: e.target.checked }, true)}
                          className="rounded border-neutral-700 bg-neutral-800 text-emerald-500 focus:ring-emerald-500/50 w-4 h-4"
                          aria-label="Drop"
                        />
                      </td>
                      <td className="p-4 min-w-[180px]">
                        <select
                          value={lead.assignedCaseAssessorId ?? ''}
                          onChange={(e) => {
                            const v = e.target.value
                            updateLead(
                              lead.id,
                              { assignedCaseAssessorId: v ? v : null },
                              true
                            )
                          }}
                          className="w-full max-w-[220px] bg-neutral-800 border border-neutral-700 rounded-md px-2 py-1 text-[11px] font-bold text-white focus:outline-none focus:ring-1 focus:ring-cyan-500 select-text"
                        >
                          <option value="">— Select case assessor —</option>
                          {assessors.map((a) => (
                            <option key={a.id} value={a.id}>
                              {a.name}
                            </option>
                          ))}
                        </select>
                      </td>
                    </motion.tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          {totalPages > 1 && (
            <div className="bg-neutral-900/80 border-t border-neutral-800 p-4 flex items-center justify-between gap-4">
              <div className="text-xs text-neutral-500">
                Showing {pageStart} to {pageEnd} of {totalLeads} leads
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  disabled={currentPage === 1}
                  onClick={() => setCurrentPage((prev) => prev - 1)}
                  className="px-3 py-1 bg-neutral-800 hover:bg-neutral-700 disabled:opacity-30 rounded text-xs transition-colors border border-neutral-700 font-bold text-white"
                >
                  Prev
                </button>
                <div className="flex bg-neutral-950 p-1 rounded-lg border border-neutral-800">
                  <span className="px-3 py-1 text-xs font-bold text-blue-400">
                    Page {currentPage} of {totalPages}
                  </span>
                </div>
                <button
                  type="button"
                  disabled={currentPage === totalPages}
                  onClick={() => setCurrentPage((prev) => prev + 1)}
                  className="px-3 py-1 bg-neutral-800 hover:bg-neutral-700 disabled:opacity-30 rounded text-xs transition-colors border border-neutral-700 font-bold text-white"
                >
                  Next
                </button>
              </div>
            </div>
          )}
        </div>

        <AnimatePresence>
          {expandedId && (
            <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
              <motion.div
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.95 }}
                className="w-full max-w-5xl bg-neutral-900 border border-neutral-800 rounded-2xl shadow-2xl p-6"
              >
                <div className="flex justify-between items-start mb-4">
                  <h3 className="text-lg font-bold text-white flex items-center gap-2">
                    <MessageSquare className="w-5 h-5 text-amber-500" /> Collaborative Case Log
                  </h3>
                  <button
                    type="button"
                    onClick={() => setExpandedId(null)}
                    className="text-neutral-500 hover:text-white pb-1 w-8 h-8 flex items-center justify-center rounded hover:bg-neutral-800 bg-neutral-950 border border-neutral-800"
                  >
                    ×
                  </button>
                </div>

                <div className="rounded-xl border border-blue-500/20 bg-blue-500/5 p-4 mb-3">
                  <p className="text-xs text-blue-200 font-semibold tracking-wide uppercase mb-3">
                    Lead Intake Form (Editable)
                  </p>
                  <div className="max-h-[52vh] overflow-y-auto pr-1">
                    {intakeDraft ? (
                      <EmployeeIntakeFormEditor form={intakeDraft} setForm={setIntakeDraft} />
                    ) : (
                      <div className="rounded-lg border border-neutral-800 bg-neutral-950/70 p-4 text-sm text-neutral-500">
                        No intake form data yet.
                      </div>
                    )}
                  </div>
                </div>

                <div className="flex justify-between items-center mt-3">
                  <span className="text-[10px] text-neutral-500 italic">Auto-sync active (1s delay)</span>
                  <button
                    type="button"
                    onClick={async () => {
                      await persistIntake()
                    }}
                    className="bg-amber-600 hover:bg-amber-700 text-neutral-950 px-3 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5"
                  >
                    <Save className="w-3 h-3" /> Save now
                  </button>
                </div>
              </motion.div>
            </div>
          )}
        </AnimatePresence>

        <input
          ref={docFileInputRef}
          type="file"
          className="hidden"
          onChange={onDocumentFileChange}
        />

        <AnimatePresence>
          {documentsLeadId && (
            <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
              <motion.div
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.95 }}
                className="w-full max-w-lg bg-neutral-900 border border-neutral-800 rounded-2xl shadow-2xl p-6 max-h-[85vh] flex flex-col"
              >
                <div className="flex justify-between items-start gap-3 mb-4">
                  <div>
                    <h3 className="text-lg font-bold text-white flex items-center gap-2">
                      <FolderOpen className="w-5 h-5 text-amber-500" /> Lead documents
                    </h3>
                    <p className="text-xs text-neutral-500 mt-1 select-text">{leadDocLabel}</p>
                  </div>
                  <button
                    type="button"
                    onClick={closeDocumentsModal}
                    className="text-neutral-500 hover:text-white w-8 h-8 flex items-center justify-center rounded hover:bg-neutral-800 border border-neutral-800 shrink-0"
                    aria-label="Close"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>

                {documentError && (
                  <p className="mb-3 text-xs text-red-300 bg-red-950/40 border border-red-900/50 rounded-lg px-3 py-2 select-text">
                    {documentError}
                  </p>
                )}

                <div className="mb-4">
                  <button
                    type="button"
                    disabled={documentUploading}
                    onClick={startAddDocument}
                    className="inline-flex items-center gap-2 bg-amber-600 hover:bg-amber-700 disabled:opacity-50 text-neutral-950 px-3 py-2 rounded-lg text-sm font-bold transition-all"
                  >
                    {documentUploading ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <Upload className="w-4 h-4" />
                    )}
                    Upload new document
                  </button>
                </div>

                <div className="overflow-y-auto flex-1 min-h-0 border border-neutral-800 rounded-xl bg-neutral-950/50">
                  {documentsLoading ? (
                    <div className="p-8 flex justify-center text-neutral-500">
                      <Loader2 className="w-6 h-6 animate-spin" />
                    </div>
                  ) : documentsList.length === 0 ? (
                    <p className="p-6 text-sm text-neutral-500 text-center">No documents yet. Upload a file to attach it to this lead.</p>
                  ) : (
                    <ul className="divide-y divide-neutral-800/80">
                      {documentsList.map((doc) => (
                        <li
                          key={doc.id}
                          className="p-3 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2"
                        >
                          <div className="min-w-0 flex-1">
                            <p className="text-sm font-medium text-white truncate select-text" title={doc.fileName}>
                              {doc.fileName}
                            </p>
                            <p className="text-[10px] text-neutral-500 mt-0.5">
                              {new Date(doc.createdAt).toLocaleString()}
                            </p>
                          </div>
                          <div className="flex items-center flex-wrap gap-1.5 shrink-0">
                            <a
                              href={doc.url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-neutral-800 hover:bg-neutral-700 border border-neutral-700 text-xs font-bold text-neutral-200"
                            >
                              <Download className="w-3.5 h-3.5" /> Open / download
                            </a>
                            <button
                              type="button"
                              disabled={documentUploading}
                              onClick={() => startReplaceDocument(doc.id)}
                              className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-neutral-800 hover:bg-neutral-700 border border-neutral-700 text-xs font-bold text-cyan-300/90 disabled:opacity-50"
                            >
                              <Upload className="w-3.5 h-3.5" /> Replace
                            </button>
                            <button
                              type="button"
                              disabled={documentDeletingId === doc.id}
                              onClick={() => deleteDocument(doc.id)}
                              className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-red-950/50 hover:bg-red-900/60 border border-red-900/50 text-xs font-bold text-red-200 disabled:opacity-50"
                            >
                              {documentDeletingId === doc.id ? (
                                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                              ) : (
                                <Trash2 className="w-3.5 h-3.5" />
                              )}{' '}
                              Delete
                            </button>
                          </div>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </motion.div>
            </div>
          )}
        </AnimatePresence>
      </main>
    </div>
  )
}
