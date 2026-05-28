'use client'

import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import Navigation from '@/components/Navigation'
import AdminDateRangeFilter from '@/components/AdminDateRangeFilter'
import { format, subDays } from 'date-fns'
import { motion, AnimatePresence } from 'framer-motion'
import {
  ClipboardList,
  Loader2,
  FolderOpen,
  Download,
  Trash2,
  Upload,
  X,
  Save,
} from 'lucide-react'
import { useRestrictCopy } from '@/hooks/useRestrictCopy'
import { CASE_STATUSES, parseCaseChecklist, type CaseChecklist } from '@/lib/lead-workflow'
import { parseEmployeeIntakeForm, type EmployeeIntakeForm } from '@/lib/employee-intake-form'
import { useVisibilityPolling } from '@/hooks/useVisibilityPolling'
import { mergeLeadDeltas } from '@/lib/lead-sync-client'
import EmployeeIntakeFormEditor from '@/components/employee/EmployeeIntakeFormEditor'

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
  caseStatus: string
  preSipAt: string | null
  assignedTo: { name: string } | null
  assignedAdvisor: { name: string } | null
  remarks: string | null
  updatedAt: string
  hasChecklist?: boolean
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

export default function CaseAssessorPage() {
  const [leads, setLeads] = useState<Lead[]>([])
  const [loading, setLoading] = useState(true)
  const [currentPage, setCurrentPage] = useState(1)
  const [totalLeads, setTotalLeads] = useState(0)
  const [totalPages, setTotalPages] = useState(1)
  const pageSize = 50
  const lastSyncRef = useRef<string | null>(null)
  const [dateFrom, setDateFrom] = useState(() => format(subDays(new Date(), 30), 'yyyy-MM-dd'))
  const [dateTo, setDateTo] = useState(() => format(new Date(), 'yyyy-MM-dd'))
  const [activeRange, setActiveRange] = useState<{ from: string; to: string } | null>(null)
  const [documentsLeadId, setDocumentsLeadId] = useState<string | null>(null)
  const [documentsList, setDocumentsList] = useState<LeadDocumentRow[]>([])
  const [documentsLoading, setDocumentsLoading] = useState(false)
  const [documentUploading, setDocumentUploading] = useState(false)
  const [documentDeletingId, setDocumentDeletingId] = useState<string | null>(null)
  const [documentError, setDocumentError] = useState<string | null>(null)
  const [checklistLeadId, setChecklistLeadId] = useState<string | null>(null)
  const [checklistDraft, setChecklistDraft] = useState<CaseChecklist | null>(null)
  const [intakeDraft, setIntakeDraft] = useState<EmployeeIntakeForm | null>(null)
  const [savingChecklist, setSavingChecklist] = useState(false)
  const docFileInputRef = useRef<HTMLInputElement | null>(null)
  const replaceTargetDocIdRef = useRef<string | null>(null)
  const restrictCopy = useRestrictCopy()

  const fetchLeads = useCallback(
    async (opts?: { silent?: boolean; poll?: boolean }) => {
      if (!opts?.silent && !opts?.poll) setLoading(true)
      try {
        const params = new URLSearchParams()
        if (dateFrom && dateTo) {
          params.set('from', dateFrom)
          params.set('to', dateTo)
        }
        if (opts?.poll && lastSyncRef.current) {
          params.set('since', lastSyncRef.current)
        } else {
          params.set('page', String(currentPage))
          params.set('pageSize', String(pageSize))
        }
        const res = await fetch(`/api/case-assessor/leads?${params}`)
        const data = await res.json()
        if (opts?.poll && data.deltas) {
          setLeads((prev) => mergeLeadDeltas<Lead>(prev, data.deltas as Lead[]))
          if (data.serverTime) lastSyncRef.current = data.serverTime
          return
        }
        if (data.leads) setLeads(data.leads)
        if (typeof data.total === 'number') setTotalLeads(data.total)
        if (typeof data.totalPages === 'number') setTotalPages(data.totalPages)
        setActiveRange(data.range ?? null)
        if (data.serverTime) lastSyncRef.current = data.serverTime
      } finally {
        if (!opts?.silent && !opts?.poll) setLoading(false)
      }
    },
    [dateFrom, dateTo, currentPage, pageSize]
  )

  useEffect(() => {
    void fetchLeads()
  }, [fetchLeads])

  useVisibilityPolling(
    () => fetchLeads({ silent: true, poll: true }),
    [fetchLeads],
    { intervalMs: 120_000 }
  )

  const updateLead = async (
    id: string,
    updates: {
      caseStatus?: string
      caseChecklist?: unknown
      preSipAt?: string | null
      employeeIntakeForm?: unknown
    }
  ) => {
    setLeads((prev) => prev.map((l) => (l.id === id ? { ...l, ...updates } : l)))
    await fetch(`/api/case-assessor/leads/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updates),
    })
  }

  const openChecklistModal = async (lead: Lead) => {
    setChecklistLeadId(lead.id)
    try {
      const res = await fetch(`/api/case-assessor/leads/${lead.id}`, { cache: 'no-store' })
      const data = await res.json()
      setChecklistDraft(parseCaseChecklist(data.lead?.caseChecklist ?? null))
      const parsed = parseEmployeeIntakeForm(data.lead?.employeeIntakeForm ?? null)
      const resolvedName = [lead.firstName, lead.lastName].filter(Boolean).join(' ').trim()
      if (!parsed.fullName && resolvedName) parsed.fullName = resolvedName
      if (!parsed.callingNumber && lead.phone) parsed.callingNumber = lead.phone
      if (!parsed.emailAddress && lead.email) parsed.emailAddress = lead.email
      if (parsed.whatsappSameAsCalling && !parsed.whatsappNumber && parsed.callingNumber) {
        parsed.whatsappNumber = parsed.callingNumber
      }
      setIntakeDraft(parsed)
    } catch {
      setChecklistDraft(parseCaseChecklist(null))
      setIntakeDraft(parseEmployeeIntakeForm(null))
    }
  }
  const closeChecklistModal = () => {
    setChecklistLeadId(null)
    setChecklistDraft(null)
    setIntakeDraft(null)
  }
  const saveChecklist = async () => {
    if (!checklistLeadId || !checklistDraft) return
    setSavingChecklist(true)
    try {
      await updateLead(checklistLeadId, {
        caseChecklist: checklistDraft,
        employeeIntakeForm: intakeDraft ?? undefined,
      })
      setLeads((prev) =>
        prev.map((l) =>
          l.id === checklistLeadId ? { ...l, hasChecklist: true } : l
        )
      )
      closeChecklistModal()
    } finally {
      setSavingChecklist(false)
    }
  }

  const loadDocumentsForLead = async (leadId: string) => {
    setDocumentsLoading(true)
    try {
      const res = await fetch(`/api/case-assessor/leads/${leadId}/documents`)
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

  const refreshLeads = () => fetchLeads({ silent: true })

  const uploadDocument = async (file: File) => {
    if (!documentsLeadId) return
    setDocumentUploading(true)
    setDocumentError(null)
    try {
      const fd = new FormData()
      fd.append('file', file)
      const res = await fetch(`/api/case-assessor/leads/${documentsLeadId}/documents`, {
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
        `/api/case-assessor/leads/${documentsLeadId}/documents/${docId}`,
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
      const postRes = await fetch(`/api/case-assessor/leads/${documentsLeadId}/documents`, {
        method: 'POST',
        body: fd,
      })
      if (!postRes.ok) {
        setDocumentError(await errorMessageFromResponse(postRes))
        return
      }
      const delRes = await fetch(
        `/api/case-assessor/leads/${documentsLeadId}/documents/${oldDocId}`,
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
  const checklistLead = checklistLeadId ? leads.find((l) => l.id === checklistLeadId) : null
  const pageStart = totalLeads === 0 ? 0 : (currentPage - 1) * pageSize + 1
  const pageEnd = Math.min(currentPage * pageSize, totalLeads)

  return (
    <div
      className="min-h-screen bg-neutral-950 text-neutral-200 select-none"
      {...restrictCopy}
    >
      <Navigation />
      <main className="max-w-[1400px] mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <h1 className="text-2xl font-bold text-white flex items-center gap-2 mb-2">
          <ClipboardList className="w-7 h-7 text-cyan-500" />
          Case Assessor
        </h1>
        <p className="text-neutral-400 text-sm mb-4">Leads assigned to you by an advisor.</p>

        <div className="mb-6">
          <AdminDateRangeFilter
            dateFrom={dateFrom}
            dateTo={dateTo}
            onDateFromChange={setDateFrom}
            onDateToChange={setDateTo}
            onAllTime={() => {
              setDateFrom('')
              setDateTo('')
              setCurrentPage(1)
            }}
          />
          {activeRange ? (
            <p className="text-xs text-cyan-500/90 mt-2 font-mono">
              Showing leads last updated in period: {activeRange.from} → {activeRange.to}
            </p>
          ) : (
            <p className="text-xs text-neutral-500 mt-2">Showing all assigned leads (all time).</p>
          )}
        </div>

        <div className="bg-neutral-900/50 border border-neutral-800 rounded-2xl overflow-hidden">
          {loading ? (
            <div className="p-12 flex justify-center text-neutral-500">
              <Loader2 className="w-8 h-8 animate-spin" />
            </div>
          ) : leads.length === 0 ? (
            <p className="p-12 text-center text-neutral-500">No cases assigned yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm min-w-[720px]">
                <thead>
                  <tr className="border-b border-neutral-800 text-xs uppercase tracking-wider text-neutral-400">
                    <th className="p-4 font-medium">Name</th>
                    <th className="p-4 font-medium">Phone</th>
                    <th className="p-4 font-medium">Employee</th>
                    <th className="p-4 font-medium">Advisor</th>
                    <th className="p-4 font-medium">SIP timing</th>
                    <th className="p-4 font-medium text-center">Case status</th>
                    <th className="p-4 font-medium text-center">Checklist used</th>
                    <th className="p-4 font-medium text-center">Checklist</th>
                    <th className="p-4 font-medium text-center">Documents</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-neutral-800/50">
                  {leads.map((l) => (
                    <tr key={l.id} className="hover:bg-neutral-800/20">
                      <td className="p-4 text-white font-medium">
                        {[l.firstName, l.lastName].filter(Boolean).join(' ') || '—'}
                      </td>
                      <td className="p-4 font-mono text-neutral-300">
                        <a
                          href={`tel:${l.phone}`}
                          className="hover:text-cyan-400 underline decoration-neutral-700 underline-offset-4"
                        >
                          {l.phone}
                        </a>
                      </td>
                      <td className="p-4 text-neutral-400">{l.assignedTo?.name || '—'}</td>
                      <td className="p-4 text-neutral-400">{l.assignedAdvisor?.name || '—'}</td>
                      <td className="p-4 min-w-[190px]">
                        <input
                          type="datetime-local"
                          value={l.preSipAt ? l.preSipAt.slice(0, 16) : ''}
                          onChange={(e) =>
                            updateLead(
                              l.id,
                              { preSipAt: e.target.value ? new Date(e.target.value).toISOString() : null }
                            )
                          }
                          className="w-full bg-neutral-800 border border-neutral-700 rounded-md px-2 py-1 text-[11px] text-white focus:outline-none focus:ring-1 focus:ring-cyan-500"
                        />
                      </td>
                      <td className="p-4 text-center">
                        <select
                          value={l.caseStatus || 'PENDING'}
                          onChange={(e) => updateLead(l.id, { caseStatus: e.target.value })}
                          className="bg-neutral-800 border border-neutral-700 rounded-md px-2 py-1 text-[11px] font-bold text-white focus:outline-none focus:ring-1 focus:ring-cyan-500"
                        >
                          {CASE_STATUSES.map((s) => (
                            <option key={s} value={s}>
                              {s}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className="p-4 text-center">
                        <span
                          className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                            l.hasChecklist
                              ? 'bg-emerald-500/10 text-emerald-400 ring-1 ring-emerald-500/25'
                              : 'bg-neutral-800 text-neutral-400 ring-1 ring-neutral-700'
                          }`}
                        >
                          {l.hasChecklist ? 'Used' : 'Not used'}
                        </span>
                      </td>
                      <td className="p-4 text-center">
                        <button
                          type="button"
                          onClick={() => openChecklistModal(l)}
                          className="px-2 py-1 rounded-md text-[11px] border border-neutral-700 bg-neutral-800 hover:bg-neutral-700"
                        >
                          Open
                        </button>
                      </td>
                      <td className="p-4 text-center">
                        <button
                          type="button"
                          onClick={() => openDocumentsModal(l.id)}
                          className="inline-flex items-center gap-1.5 px-2 py-1 rounded-lg border border-neutral-700 bg-neutral-800/80 hover:bg-neutral-800 text-[11px] font-bold text-neutral-200 transition-colors"
                          title="Manage documents"
                        >
                          <FolderOpen className="w-3.5 h-3.5 text-cyan-500" />
                          <span className="tabular-nums text-neutral-400">
                            {l._count?.documents ?? 0}
                          </span>
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {totalPages > 1 && (
            <div className="flex items-center justify-between px-4 py-3 border-t border-neutral-800 text-xs text-neutral-500">
              <span>
                Showing {pageStart}–{pageEnd} of {totalLeads}
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

        <input
          ref={docFileInputRef}
          type="file"
          className="hidden"
          onChange={onDocumentFileChange}
        />

        <AnimatePresence>
          {checklistLeadId && checklistDraft && (
            <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
              <motion.div
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.95 }}
                className="w-full max-w-2xl bg-neutral-900 border border-neutral-800 rounded-2xl shadow-2xl p-6 max-h-[90vh] overflow-y-auto"
              >
                <div className="flex justify-between items-center mb-4">
                  <h3 className="text-lg font-bold text-white">Case completion checklist</h3>
                  <button type="button" onClick={closeChecklistModal} className="text-neutral-400 hover:text-white">Close</button>
                </div>
                <div className="rounded-xl border border-cyan-500/20 bg-cyan-500/5 p-4 mb-4">
                  <p className="text-xs text-cyan-200 font-semibold tracking-wide uppercase mb-3">
                    Full Intake Form (Editable)
                  </p>
                  <div className="max-h-[40vh] overflow-y-auto pr-1">
                    {intakeDraft ? (
                      <EmployeeIntakeFormEditor form={intakeDraft} setForm={setIntakeDraft} />
                    ) : (
                      <div className="rounded-lg border border-neutral-800 bg-neutral-950/70 p-4 text-sm text-neutral-500">
                        No intake form data yet.
                      </div>
                    )}
                  </div>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
                  <div>
                    <label className="block text-xs text-neutral-500 mb-1">Income monthly</label>
                    <input value={checklistDraft.incomeMonthly} onChange={(e) => setChecklistDraft({ ...checklistDraft, incomeMonthly: e.target.value, incomeEligible: Number(e.target.value || 0) >= 1000 })} className="w-full rounded-lg border border-neutral-800 bg-neutral-950 px-3 py-2 text-white" />
                  </div>
                  <label className="inline-flex items-center gap-2 mt-6"><input type="checkbox" checked={checklistDraft.incomeEligible} onChange={(e) => setChecklistDraft({ ...checklistDraft, incomeEligible: e.target.checked })} /> Income {'>='} 1000</label>
                  <div>
                    <label className="block text-xs text-neutral-500 mb-1">Employment status</label>
                    <select value={checklistDraft.employmentStatus} onChange={(e) => setChecklistDraft({ ...checklistDraft, employmentStatus: e.target.value as CaseChecklist['employmentStatus'] })} className="w-full rounded-lg border border-neutral-800 bg-neutral-950 px-3 py-2 text-white">
                      <option value="">—</option><option value="FULL_TIME">Full time</option><option value="PART_TIME">Part time</option><option value="SELF_EMPLOYED">Self employed</option><option value="BENEFIT">Benefit</option>
                    </select>
                  </div>
                  <label className="inline-flex items-center gap-2 mt-6"><input type="checkbox" checked={checklistDraft.payslipVerified} onChange={(e) => setChecklistDraft({ ...checklistDraft, payslipVerified: e.target.checked })} /> Payslip / evidence verified</label>
                  <label className="inline-flex items-center gap-2"><input type="checkbox" checked={checklistDraft.universalCreditStatementUploaded} onChange={(e) => setChecklistDraft({ ...checklistDraft, universalCreditStatementUploaded: e.target.checked })} /> UC statement uploaded</label>
                  <label className="inline-flex items-center gap-2"><input type="checkbox" checked={checklistDraft.universalCreditVisible} onChange={(e) => setChecklistDraft({ ...checklistDraft, universalCreditVisible: e.target.checked })} /> UC visible in statement</label>
                  <div>
                    <label className="block text-xs text-neutral-500 mb-1">Living status</label>
                    <select value={checklistDraft.livingStatus} onChange={(e) => setChecklistDraft({ ...checklistDraft, livingStatus: e.target.value as CaseChecklist['livingStatus'] })} className="w-full rounded-lg border border-neutral-800 bg-neutral-950 px-3 py-2 text-white">
                      <option value="">—</option><option value="SINGLE">Single</option><option value="PARTNER">Partner</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs text-neutral-500 mb-1">Kids DOB (comma separated)</label>
                    <input value={checklistDraft.kidsDob.join(', ')} onChange={(e) => setChecklistDraft({ ...checklistDraft, kidsDob: e.target.value.split(',').map((x) => x.trim()).filter(Boolean), hasKids: e.target.value.trim().length > 0 })} className="w-full rounded-lg border border-neutral-800 bg-neutral-950 px-3 py-2 text-white" />
                  </div>
                  <label className="inline-flex items-center gap-2"><input type="checkbox" checked={checklistDraft.hasCar} onChange={(e) => setChecklistDraft({ ...checklistDraft, hasCar: e.target.checked })} /> Has car</label>
                  <input value={checklistDraft.carRegistration} onChange={(e) => setChecklistDraft({ ...checklistDraft, carRegistration: e.target.value })} placeholder="Car reg no." className="rounded-lg border border-neutral-800 bg-neutral-950 px-3 py-2 text-white" />
                  <div>
                    <label className="block text-xs text-neutral-500 mb-1">ID proof</label>
                    <select value={checklistDraft.idProofType} onChange={(e) => setChecklistDraft({ ...checklistDraft, idProofType: e.target.value as CaseChecklist['idProofType'] })} className="w-full rounded-lg border border-neutral-800 bg-neutral-950 px-3 py-2 text-white">
                      <option value="">—</option><option value="PASSPORT">Passport</option><option value="DRIVING_LICENCE">Driving licence</option>
                    </select>
                  </div>
                  <label className="inline-flex items-center gap-2 mt-6"><input type="checkbox" checked={checklistDraft.nonEnglish} onChange={(e) => setChecklistDraft({ ...checklistDraft, nonEnglish: e.target.checked })} /> Non-English customer</label>
                  <label className="inline-flex items-center gap-2"><input type="checkbox" checked={checklistDraft.rightToRemainUploaded} onChange={(e) => setChecklistDraft({ ...checklistDraft, rightToRemainUploaded: e.target.checked })} /> Right to remain uploaded</label>
                  <label className="inline-flex items-center gap-2"><input type="checkbox" checked={checklistDraft.amlCheckRequired} onChange={(e) => setChecklistDraft({ ...checklistDraft, amlCheckRequired: e.target.checked })} /> AML check required</label>
                  <div>
                    <label className="block text-xs text-neutral-500 mb-1">Debt level</label>
                    <input value={checklistDraft.debtLevel} onChange={(e) => setChecklistDraft({ ...checklistDraft, debtLevel: e.target.value })} className="w-full rounded-lg border border-neutral-800 bg-neutral-950 px-3 py-2 text-white" />
                  </div>
                  <div>
                    <label className="block text-xs text-neutral-500 mb-1">Plan if debt {'<'} 6000</label>
                    <select value={checklistDraft.debtPlan} onChange={(e) => setChecklistDraft({ ...checklistDraft, debtPlan: e.target.value as CaseChecklist['debtPlan'] })} className="w-full rounded-lg border border-neutral-800 bg-neutral-950 px-3 py-2 text-white">
                      <option value="">—</option><option value="DISSOLVE_DEBT">Dissolve debt</option><option value="DM">DM</option>
                    </select>
                  </div>
                </div>
                <label className="inline-flex items-center gap-2 mt-4 text-sm"><input type="checkbox" checked={checklistDraft.threeWayCallCompleted} onChange={(e) => setChecklistDraft({ ...checklistDraft, threeWayCallCompleted: e.target.checked })} /> Three-way call completed (Council / DWP / collections)</label>
                <textarea value={checklistDraft.notes} onChange={(e) => setChecklistDraft({ ...checklistDraft, notes: e.target.value })} rows={3} className="mt-3 w-full rounded-lg border border-neutral-800 bg-neutral-950 px-3 py-2 text-white" placeholder="Case notes..." />
                <div className="mt-4 flex justify-end">
                  <button type="button" onClick={saveChecklist} disabled={savingChecklist} className="inline-flex items-center gap-2 bg-cyan-600 hover:bg-cyan-500 disabled:opacity-50 text-neutral-950 px-4 py-2 rounded-lg text-sm font-bold">
                    {savingChecklist ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                    Save checklist
                  </button>
                </div>
              </motion.div>
            </div>
          )}
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
                      <FolderOpen className="w-5 h-5 text-cyan-500" /> Lead documents
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
                    className="inline-flex items-center gap-2 bg-cyan-600 hover:bg-cyan-500 disabled:opacity-50 text-neutral-950 px-3 py-2 rounded-lg text-sm font-bold transition-all"
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
                    <p className="p-6 text-sm text-neutral-500 text-center">
                      No documents yet. Upload a file to attach it to this lead.
                    </p>
                  ) : (
                    <ul className="divide-y divide-neutral-800/80">
                      {documentsList.map((doc) => (
                        <li
                          key={doc.id}
                          className="p-3 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2"
                        >
                          <div className="min-w-0 flex-1">
                            <p
                              className="text-sm font-medium text-white truncate select-text"
                              title={doc.fileName}
                            >
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
