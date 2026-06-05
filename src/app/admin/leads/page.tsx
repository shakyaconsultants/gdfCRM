'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import Navigation from '@/components/Navigation'
import { motion, AnimatePresence } from 'framer-motion'
import { Upload, Loader2, MessageSquare, Search, Filter, Trash2, TrendingUp } from 'lucide-react'
import { LEAD_PHONE_HELP_TEXT } from '@/lib/phone'
import { apiErrorMessage } from '@/lib/api-error-message'
import {
  friendlyLeadImportError,
  LEAD_IMPORT_ACCEPT,
  mapLeadImportRows,
  parseLeadImportFile,
  validateLeadImportFile,
} from '@/lib/lead-import'
import { LEAD_DISPOSITIONS } from '@/lib/lead-workflow'
import { useVisibilityPolling } from '@/hooks/useVisibilityPolling'
import { LeadSaveQueue } from '@/lib/lead-save-queue'
import { ADMIN_LEADS_PAGE_SIZE } from '@/lib/admin-leads-config'
import { MIN_LEAD_SEARCH_LENGTH } from '@/lib/lead-search-filter'
import AdminLeadTableRow, { type AdminLeadRow } from '@/components/admin/AdminLeadTableRow'

type Employee = { id: string; name: string; email: string }
type Lead = AdminLeadRow & {
  assignedToId?: string | null
  remarks?: string | null
}

type LeadDetail = {
  remarks: string | null
  address: string | null
  addressLine1: string | null
  addressLine2: string | null
  addressLine3: string | null
  addressLine4: string | null
  postCode: string | null
  assignedTo: { name: string } | null
}

const EMPLOYEES_CACHE_KEY = 'crm_admin_employees_v1'
const EMPLOYEES_CACHE_MS = 5 * 60 * 1000

const DISPOSITIONS = ['All', ...LEAD_DISPOSITIONS]

export default function AdminLeadsPage() {
  const [leads, setLeads] = useState<Lead[]>([])
  const [employees, setEmployees] = useState<Employee[]>([])
  const [selectedLeads, setSelectedLeads] = useState<Set<string>>(new Set())
  const [selectedEmployeeId, setSelectedEmployeeId] = useState('')
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [uploading, setUploading] = useState(false)
  const [assigning, setAssigning] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [loading, setLoading] = useState(true)
  const [pageLoading, setPageLoading] = useState(false)
  const [searchTerm, setSearchTerm] = useState('')
  const [filterDisposition, setFilterDisposition] = useState('All')
  const [commonQty, setCommonQty] = useState<number | ''>('')
  const [notification, setNotification] = useState<{ message: string, type: 'success' | 'warn' } | null>(null)
  
  const [currentPage, setCurrentPage] = useState(1)
  const [totalLeads, setTotalLeads] = useState<number | null>(null)
  const [totalPages, setTotalPages] = useState(1)
  const [hasMore, setHasMore] = useState(false)
  const [countLoading, setCountLoading] = useState(false)
  const pageSize = ADMIN_LEADS_PAGE_SIZE
  const [displaySearchTerm, setDisplaySearchTerm] = useState('')
  const [showSelectedOnly, setShowSelectedOnly] = useState(false)
  const [expandedDetail, setExpandedDetail] = useState<LeadDetail | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [selectAllLoading, setSelectAllLoading] = useState(false)
  const [bulkSelectAll, setBulkSelectAll] = useState(false)

  const saveQueueRef = useRef(new LeadSaveQueue())
  const selectAllAbortRef = useRef<AbortController | null>(null)
  const headerCheckboxRef = useRef<HTMLInputElement>(null)
  const fetchSeqRef = useRef(0)
  const countSeqRef = useRef(0)
  const pausePollRef = useRef(false)
  const leadsReadyRef = useRef(false)
  const selectedLeadsRef = useRef(selectedLeads)
  selectedLeadsRef.current = selectedLeads

  const selectedIdsKey = showSelectedOnly
    ? Array.from(selectedLeads).sort().join(',')
    : ''

  const buildLeadsQuery = useCallback(
    (overrides?: {
      page?: number
      pageSize?: number
      idsOnly?: boolean
      unassignedOnly?: boolean
      countOnly?: boolean
    }) => {
      const params = new URLSearchParams()
      params.set('page', String(overrides?.page ?? currentPage))
      params.set('pageSize', String(overrides?.pageSize ?? pageSize))
      if (searchTerm) params.set('search', searchTerm)
      if (filterDisposition !== 'All') params.set('disposition', filterDisposition)
      if (overrides?.unassignedOnly) params.set('unassignedOnly', 'true')
      if (overrides?.idsOnly) params.set('idsOnly', 'true')
      if (overrides?.countOnly) params.set('countOnly', 'true')
      if (showSelectedOnly && selectedLeadsRef.current.size > 0) {
        params.set('ids', Array.from(selectedLeadsRef.current).join(','))
      }
      return params
    },
    [currentPage, pageSize, searchTerm, filterDisposition, showSelectedOnly]
  )

  const fetchLeadCount = useCallback(async () => {
    if (showSelectedOnly && selectedLeadsRef.current.size === 0) {
      setTotalLeads(0)
      setTotalPages(1)
      return
    }
    const seq = ++countSeqRef.current
    setCountLoading(true)
    try {
      const params = buildLeadsQuery({ countOnly: true })
      const res = await fetch(`/api/admin/leads?${params.toString()}`, {
        cache: 'no-store',
        credentials: 'include',
      })
      if (seq !== countSeqRef.current || !res.ok) return
      const data = await res.json()
      if (typeof data.total === 'number') {
        setTotalLeads(data.total)
        setTotalPages(
          data.totalPages ?? Math.max(1, Math.ceil(data.total / pageSize))
        )
      }
    } finally {
      if (seq === countSeqRef.current) setCountLoading(false)
    }
  }, [buildLeadsQuery, pageSize, showSelectedOnly, selectedIdsKey])

  const fetchLeads = useCallback(
    async (opts?: { silent?: boolean; page?: number; refreshCount?: boolean }) => {
      if (showSelectedOnly && selectedLeadsRef.current.size === 0) {
        setLeads([])
        setTotalLeads(0)
        setTotalPages(1)
        setHasMore(false)
        setLoading(false)
        setPageLoading(false)
        return
      }

      const seq = ++fetchSeqRef.current
      if (opts?.silent) setPageLoading(true)
      else setLoading(true)

      try {
        const params = buildLeadsQuery({ page: opts?.page ?? currentPage })
        const leadsRes = await fetch(`/api/admin/leads?${params.toString()}`, {
          cache: 'no-store',
          credentials: 'include',
        })
        if (seq !== fetchSeqRef.current) return
        if (!leadsRes.ok) {
          const err = await leadsRes.json().catch(() => ({}))
          setNotification({
            message:
              leadsRes.status === 401
                ? 'Session expired — log in again as admin.'
                : typeof err.error === 'string'
                  ? err.error
                  : `Failed to load leads (${leadsRes.status})`,
            type: 'warn',
          })
          return
        }
        const leadsData = await leadsRes.json()
        if (seq !== fetchSeqRef.current) return
        if (leadsData.leads) {
          const skipIds = opts?.silent ? saveQueueRef.current.pendingLeadIds() : null
          if (skipIds?.size) {
            setLeads((prev) => {
              const prevById = new Map(prev.map((l) => [l.id, l]))
              return (leadsData.leads as Lead[]).map((l) =>
                skipIds.has(l.id) ? (prevById.get(l.id) ?? l) : l
              )
            })
          } else {
            setLeads(leadsData.leads)
          }
        }
        if (typeof leadsData.hasMore === 'boolean') {
          setHasMore(leadsData.hasMore)
        }
        leadsReadyRef.current = true
        if (!opts?.silent && (opts?.refreshCount !== false)) {
          void fetchLeadCount()
        }
      } finally {
        if (seq === fetchSeqRef.current) {
          setLoading(false)
          setPageLoading(false)
        }
      }
    },
    [buildLeadsQuery, currentPage, fetchLeadCount, showSelectedOnly, selectedIdsKey]
  )

  const fetchEmployees = useCallback(async () => {
    try {
      if (typeof sessionStorage !== 'undefined') {
        const raw = sessionStorage.getItem(EMPLOYEES_CACHE_KEY)
        if (raw) {
          const cached = JSON.parse(raw) as { ts: number; employees: Employee[] }
          if (Date.now() - cached.ts < EMPLOYEES_CACHE_MS && cached.employees?.length) {
            setEmployees(cached.employees)
            return
          }
        }
      }
      const empRes = await fetch('/api/admin/employees', { cache: 'no-store', credentials: 'include' })
      const empData = await empRes.json()
      if (empData.employees) {
        const slim: Employee[] = empData.employees.map((e: Employee) => ({
          id: e.id,
          name: e.name,
          email: e.email,
        }))
        setEmployees(slim)
        try {
          sessionStorage.setItem(
            EMPLOYEES_CACHE_KEY,
            JSON.stringify({ ts: Date.now(), employees: slim })
          )
        } catch {
          /* quota */
        }
      }
    } catch {
      /* employees list is non-blocking */
    }
  }, [])

  useEffect(() => {
    const t = setTimeout(() => void fetchEmployees(), 800)
    return () => clearTimeout(t)
  }, [fetchEmployees])

  useEffect(() => {
    void fetchLeads()
  }, [fetchLeads])

  useVisibilityPolling(
    () => {
      if (pausePollRef.current || !leadsReadyRef.current) return
      void fetchLeads({ silent: true, refreshCount: false })
    },
    [fetchLeads],
    { intervalMs: 300_000 }
  )

  const deselectAll = useCallback(() => {
    selectAllAbortRef.current?.abort()
    selectAllAbortRef.current = null
    setSelectAllLoading(false)
    setBulkSelectAll(false)
    setSelectedLeads(new Set())
    setShowSelectedOnly(false)
  }, [])

  useEffect(() => {
    const timer = setTimeout(() => {
      setTotalLeads(null)
      const q = displaySearchTerm.trim()
      setSearchTerm(q.length === 0 || q.length >= MIN_LEAD_SEARCH_LENGTH ? q : '')
      setCurrentPage(1)
      deselectAll()
    }, 500)
    return () => clearTimeout(timer)
  }, [displaySearchTerm, deselectAll])

  const canGoPrev = currentPage > 1
  const canGoNext = hasMore || (totalLeads != null && currentPage < totalPages)
  const pageStart = leads.length === 0 ? 0 : (currentPage - 1) * pageSize + 1
  const pageEnd = pageStart === 0 ? 0 : pageStart + leads.length - 1
  const hasSelection = selectedLeads.size > 0
  const allOnCurrentPage =
    leads.length > 0 && leads.every((l) => selectedLeads.has(l.id))
  const fullBulkSelected =
    bulkSelectAll ||
    (totalLeads != null &&
      totalLeads > 0 &&
      selectedLeads.size >= Math.min(totalLeads, 5000))

  useEffect(() => {
    const el = headerCheckboxRef.current
    if (!el) return
    el.checked = fullBulkSelected || (hasSelection && allOnCurrentPage && leads.length > 0)
    el.indeterminate = hasSelection && !el.checked
  }, [hasSelection, fullBulkSelected, allOnCurrentPage, leads.length, selectedLeads.size])

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return

    const earlyError = validateLeadImportFile(file)
    if (earlyError) {
      setNotification({ message: earlyError, type: 'warn' })
      return
    }

    setUploading(true)
    try {
      let parsedRows: ReturnType<typeof mapLeadImportRows>
      try {
        const data = await parseLeadImportFile(file)
        parsedRows = mapLeadImportRows(data)
      } catch (parseErr) {
        console.error('[LEAD IMPORT] parse failed', {
          file: file.name,
          size: file.size,
          type: file.type,
          error: parseErr,
        })
        setNotification({
          message: friendlyLeadImportError(parseErr, file.name),
          type: 'warn',
        })
        return
      }

      const formattedData = parsedRows.filter(
        (r) => (r.firstName || r.lastName) && r.phone !== ''
      )
      const droppedInvalidPhone = parsedRows.filter(
        (r) => (r.firstName || r.lastName) && r.phone === ''
      ).length

      if (formattedData.length === 0) {
        setNotification({
          message:
            droppedInvalidPhone > 0
              ? `No rows to import. ${droppedInvalidPhone} row(s) had a name but no valid phone. ${LEAD_PHONE_HELP_TEXT}`
              : 'No rows to import. Each row needs at least a first or last name and a valid phone number in a column named Phone (or Number).',
          type: 'warn',
        })
        return
      }

      const formData = new FormData()
      formData.append('file', file)
      const uploadRes = await fetch('/api/admin/upload', {
        method: 'POST',
        body: formData,
        credentials: 'include',
      })

      let uploadData: { success?: boolean; result?: { secure_url?: string }; error?: string }
      try {
        uploadData = await uploadRes.json()
      } catch {
        setNotification({
          message: await apiErrorMessage(uploadRes, 'Upload failed — server returned an invalid response.'),
          type: 'warn',
        })
        return
      }

      if (!uploadRes.ok || !uploadData.success) {
        setNotification({
          message:
            uploadData.error ||
            (await apiErrorMessage(uploadRes, 'Could not store the file on the server.')),
          type: 'warn',
        })
        return
      }

      const res = await fetch('/api/admin/leads', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          leads: formattedData,
          fileUrl: uploadData.result?.secure_url ?? null,
        }),
      })

      let result: { success?: boolean; error?: string; createdCount?: number; skippedCount?: number }
      try {
        result = await res.json()
      } catch {
        setNotification({
          message: await apiErrorMessage(res, 'Import failed — server returned an invalid response.'),
          type: 'warn',
        })
        return
      }

      if (!res.ok || !result.success) {
        setNotification({
          message: result.error || (await apiErrorMessage(res, 'Import failed on the server.')),
          type: 'warn',
        })
        return
      }

      const parts = [
        `Imported ${result.createdCount ?? 0} new lead(s)`,
        (result.skippedCount ?? 0) > 0
          ? `${result.skippedCount} skipped (duplicate phone or invalid row)`
          : null,
        droppedInvalidPhone > 0
          ? `${droppedInvalidPhone} row(s) skipped (name present but phone missing or invalid)`
          : null,
      ].filter(Boolean)
      setNotification({ message: `${parts.join('. ')}.`, type: 'success' })
      setTotalLeads(null)
      setCurrentPage(1)
      void fetchLeads({ page: 1 })
    } catch (err) {
      console.error('[LEAD IMPORT] upload/import failed', { file: file.name, error: err })
      setNotification({
        message: friendlyLeadImportError(err, file.name),
        type: 'warn',
      })
    } finally {
      setUploading(false)
    }
  }

  const handleAssign = async () => {
    if (selectedLeads.size === 0 || !selectedEmployeeId || assigning) return
    const ids = Array.from(selectedLeads)
    const employee = employees.find((e) => e.id === selectedEmployeeId)
    setAssigning(true)
    pausePollRef.current = true
    setLeads((prev) =>
      prev.map((l) =>
        ids.includes(l.id)
          ? {
              ...l,
              assignedTo: employee ? { name: employee.name } : l.assignedTo,
            }
          : l
      )
    )
    try {
      const res = await fetch('/api/admin/leads', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ leadIds: ids, assignedToId: selectedEmployeeId }),
      })
      const payload = await res.json().catch(() => ({}))
      if (res.ok) {
        deselectAll()
        await fetchLeads()
        setNotification({
          message: `Assigned ${payload.updatedCount ?? ids.length} lead(s) to ${payload.assignedToName ?? employee?.name ?? 'employee'}`,
          type: 'success',
        })
      } else {
        await fetchLeads()
        setNotification({ message: payload.error || 'Failed to assign leads', type: 'warn' })
      }
    } catch (e) {
      console.error(e)
      await fetchLeads()
      setNotification({ message: 'Failed to assign leads', type: 'warn' })
    } finally {
      pausePollRef.current = false
      setAssigning(false)
    }
  }

  const handleDelete = async () => {
    if (selectedLeads.size === 0 || deleting) return
    if (!confirm(`Delete ${selectedLeads.size} leads?`)) return
    setDeleting(true)
    try {
      const res = await fetch('/api/admin/leads', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ leadIds: Array.from(selectedLeads) })
      })
      const payload = await res.json().catch(() => ({}))
      if (res.ok) {
        deselectAll()
        void fetchLeads()
        setNotification({ message: `Leads deleted (${payload.deletedCount ?? 0})`, type: 'success' })
      } else {
        setNotification({ message: payload.error || 'Failed to delete leads', type: 'warn' })
      }
    } catch (e) { console.error(e) }
    finally { setDeleting(false) }
  }

  const toggleSelect = (id: string) => {
    const next = new Set(selectedLeads)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    setSelectedLeads(next)
    setBulkSelectAll(false)
  }

  const toggleSelectAll = async () => {
    if (hasSelection || selectAllLoading) {
      deselectAll()
      setNotification({ message: 'Deselected all leads', type: 'success' })
      return
    }

    if (leads.length > 0) {
      setSelectedLeads(new Set(leads.map((l) => l.id)))
    }

    setSelectAllLoading(true)
    pausePollRef.current = true
    selectAllAbortRef.current?.abort()
    const ac = new AbortController()
    selectAllAbortRef.current = ac

    try {
      const params = buildLeadsQuery({ page: 1, pageSize: 5000, idsOnly: true })
      const res = await fetch(`/api/admin/leads?${params.toString()}`, {
        cache: 'no-store',
        credentials: 'include',
        signal: ac.signal,
      })
      if (ac.signal.aborted) return
      const data = await res.json().catch(() => ({}))
      if (res.ok && Array.isArray(data.ids)) {
        setSelectedLeads(new Set(data.ids))
        setBulkSelectAll(true)
        const capped = typeof data.total === 'number' && data.total > data.ids.length
        setNotification({
          message: capped
            ? `Selected ${data.ids.length} of ${data.total} matching leads (5,000 cap)`
            : `Selected ${data.ids.length} lead(s) matching filters`,
          type: 'success',
        })
      }
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') return
    } finally {
      if (!ac.signal.aborted) {
        setSelectAllLoading(false)
        pausePollRef.current = false
      }
    }
  }

  const handleAutoSelect = async () => {
    const count = Number(commonQty)
    if (isNaN(count) || count <= 0) return

    setPageLoading(true)
    try {
      // Search the full unassigned pool — not the current search/disposition/selection filters.
      const params = new URLSearchParams({
        page: '1',
        pageSize: String(count),
        idsOnly: 'true',
        unassignedOnly: 'true',
      })
      const res = await fetch(`/api/admin/leads?${params.toString()}`, {
        cache: 'no-store',
        credentials: 'include',
      })
      const data = await res.json().catch(() => ({}))
      const ids: string[] = res.ok && Array.isArray(data.ids) ? data.ids : []
      const poolTotal = typeof data.total === 'number' ? data.total : ids.length

      setSelectedLeads(new Set(ids))
      setBulkSelectAll(false)
      setCommonQty('')
      setNotification({
        message:
          ids.length > 0
            ? `Selected ${ids.length} unassigned lead(s) from ${poolTotal.toLocaleString()} in the pool (newest first)`
            : 'No unassigned leads in the system — import fresh data or reassign from employees',
        type: ids.length > 0 ? 'success' : 'warn',
      })
    } finally {
      setPageLoading(false)
    }
  }

  const saveLeadPatch = useCallback(
    async (leadId: string, body: Record<string, unknown>) => {
      const res = await fetch(`/api/admin/leads/${leadId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = await res.json().catch(() => ({}))
      return { ok: res.ok, status: res.status, data }
    },
    []
  )

  const updateLead = (id: string, updates: Partial<Lead>, immediate = false) => {
    setLeads((prev) => prev.map((l) => (l.id === id ? { ...l, ...updates } : l)))
    const body = updates as Record<string, unknown>
    if (immediate) {
      void saveQueueRef.current.enqueueNow(id, body, saveLeadPatch)
    } else {
      saveQueueRef.current.schedule(id, body, saveLeadPatch, 1000)
    }
  }

  const openLeadDetail = useCallback(async (leadId: string) => {
    setExpandedId(leadId)
    setExpandedDetail(null)
    setDetailLoading(true)
    try {
      const res = await fetch(`/api/admin/leads/${leadId}`, {
        cache: 'no-store',
        credentials: 'include',
      })
      const data = await res.json().catch(() => ({}))
      if (res.ok && data.lead) {
        setExpandedDetail(data.lead as LeadDetail)
      }
    } finally {
      setDetailLoading(false)
    }
  }, [])

  const closeLeadDetail = () => {
    setExpandedId(null)
    setExpandedDetail(null)
  }

  const detailRemarks =
    expandedDetail?.remarks ?? leads.find((l) => l.id === expandedId)?.remarks ?? ''

  const forceSave = (id: string) => {
    const remarks = expandedDetail?.remarks ?? leads.find((l) => l.id === id)?.remarks ?? ''
    if (remarks !== undefined) {
      updateLead(id, { remarks }, true)
      setExpandedDetail((d) => (d ? { ...d, remarks } : d))
    }
  }

  return (
    <div className="min-h-screen bg-neutral-950 text-neutral-200 uppercase-control">
      <Navigation />
      
      <main className="max-w-[1600px] mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between mb-8 gap-6">
          <div>
            <h1 className="text-2xl font-bold text-white">Manage Leads</h1>
            <p className="text-neutral-400 text-sm mt-1 uppercase">Central command for lead distribution and upload.</p>
            <p className="text-neutral-600 text-[10px] mt-1 font-bold uppercase tracking-wider">
              {ADMIN_LEADS_PAGE_SIZE} leads per page · server-paginated
            </p>
            <p className="text-neutral-500 text-xs mt-2 normal-case">{LEAD_PHONE_HELP_TEXT}</p>
          </div>
          
          <div className="flex flex-col gap-4">
            <div className="flex flex-wrap items-center gap-4 lg:justify-end">
              <div className="relative w-full sm:w-64">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-neutral-500" />
                <input 
                  type="text" 
                  placeholder={`FIND NAME OR PHONE (${MIN_LEAD_SEARCH_LENGTH}+ CHARS)...`}
                  value={displaySearchTerm}
                  onChange={e => setDisplaySearchTerm(e.target.value)}
                  className="w-full bg-neutral-900 border border-neutral-800 rounded-lg pl-10 pr-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/50 transition-all text-white uppercase"
                />
                {displaySearchTerm.trim().length > 0 &&
                  displaySearchTerm.trim().length < MIN_LEAD_SEARCH_LENGTH && (
                    <p className="text-[10px] text-amber-500/90 mt-1 normal-case">
                      Type at least {MIN_LEAD_SEARCH_LENGTH} characters to search{' '}
                      {totalLeads != null ? `(${totalLeads.toLocaleString()} leads)` : ''}
                    </p>
                  )}
              </div>

              <div className="relative w-full sm:w-48">
                <Filter className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-neutral-500" />
                <select 
                  value={filterDisposition}
                  onChange={e => {
                    setTotalLeads(null)
                    setFilterDisposition(e.target.value)
                    setCurrentPage(1)
                    deselectAll()
                  }}
                  className="w-full bg-neutral-900 border border-neutral-800 text-white rounded-lg pl-10 pr-4 py-2 text-sm appearance-none transition-all uppercase"
                >
                  {DISPOSITIONS.map(d => <option key={d} value={d}>{d}</option>)}
                </select>
              </div>

              <button
                onClick={() => {
                  setTotalLeads(null)
                  if (showSelectedOnly) deselectAll()
                  setShowSelectedOnly(!showSelectedOnly)
                  setCurrentPage(1)
                }}
                className={`px-4 py-2 rounded-lg text-sm font-bold border transition-all flex items-center gap-2 ${
                  showSelectedOnly ? 'bg-blue-600 border-blue-500 text-white' : 'bg-neutral-900 border-neutral-800 text-neutral-400'
                }`}
              >
                <div className={`w-2 h-2 rounded-full ${showSelectedOnly ? 'bg-white animate-pulse' : 'bg-neutral-600'}`} />
                SHOW SELECTED ({selectedLeads.size})
              </button>
            </div>

            <div className="flex flex-wrap items-center gap-3 lg:justify-end w-full">
              <div className="flex items-center gap-2 bg-neutral-900 border border-neutral-800 rounded-lg p-1">
                <button 
                  onClick={handleDelete}
                  disabled={selectedLeads.size === 0 || deleting}
                  className="bg-red-600/10 hover:bg-red-600 text-red-500 hover:text-white border border-red-600/20 disabled:opacity-30 px-3 py-1.5 rounded-md text-xs font-bold transition-all flex items-center gap-1.5"
                >
                  <Trash2 className="w-3.5 h-3.5" /> DELETE
                </button>
                {hasSelection && (
                  <button
                    type="button"
                    onClick={() => {
                      deselectAll()
                      setNotification({ message: 'Deselected all leads', type: 'success' })
                    }}
                    className="bg-amber-600/20 hover:bg-amber-600 text-amber-400 hover:text-white px-3 py-1.5 rounded-md text-xs font-bold border border-amber-600/30 transition-colors"
                  >
                    DESELECT ALL ({selectedLeads.size.toLocaleString()})
                  </button>
                )}
              </div>

              <div className="flex items-center gap-2 bg-neutral-900 border border-neutral-800 rounded-lg p-1">
                <span className="text-[10px] text-neutral-500 uppercase font-black px-2 flex items-center gap-2">
                  <TrendingUp className="w-3 h-3 text-blue-500" /> QTY
                </span>
                <input 
                  type="number" min="1" placeholder="0" value={commonQty}
                  onChange={e => setCommonQty(e.target.value ? Number(e.target.value) : '')}
                  className="w-16 bg-neutral-950 text-white font-bold text-sm px-2 py-1.5 focus:outline-none rounded-md border border-neutral-800"
                />
                <button 
                  onClick={handleAutoSelect}
                  className="bg-neutral-800 hover:bg-neutral-700 text-blue-400 px-3 py-1.5 rounded-md text-[10px] font-black border border-neutral-700 transition-all active:scale-95"
                >
                  AUTO SELECT
                </button>
              </div>

              <div className="relative overflow-hidden">
                <button disabled={uploading} className="bg-neutral-800 hover:bg-neutral-700 text-white px-4 py-2 rounded-lg text-sm font-bold transition-colors flex items-center gap-2 border border-neutral-700">
                  {uploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />} UPLOAD
                </button>
                <input type="file" accept={LEAD_IMPORT_ACCEPT} onChange={handleFileUpload} className="absolute inset-0 opacity-0 cursor-pointer" disabled={uploading} />
              </div>
              
              <div className="flex items-center gap-2 bg-neutral-900 border border-neutral-800 rounded-lg p-1">
                <select value={selectedEmployeeId} onChange={e => setSelectedEmployeeId(e.target.value)} className="bg-neutral-950 text-neutral-200 text-xs pl-3 pr-8 py-1.5 focus:outline-none rounded-md border border-neutral-800 max-w-[140px] uppercase">
                  <option value="">EMPLOYEE...</option>
                  {employees.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}
                </select>
                {hasSelection && (
                  <button
                    type="button"
                    onClick={() => {
                      deselectAll()
                      setNotification({ message: 'Deselected all leads', type: 'success' })
                    }}
                    className="bg-neutral-800 hover:bg-neutral-700 text-amber-400 px-3 py-1.5 rounded-md text-xs font-bold border border-neutral-700"
                  >
                    DESELECT ALL
                  </button>
                )}
                <button onClick={handleAssign} disabled={assigning} className="bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white px-3 py-1.5 rounded-md text-xs font-bold">ASSIGN ({selectedLeads.size})</button>
              </div>
            </div>
          </div>
        </div>

        <div className="bg-neutral-900/50 border border-neutral-800 rounded-2xl overflow-hidden backdrop-blur-sm shadow-xl relative">
          {pageLoading && !loading && (
            <div className="absolute inset-x-0 top-0 z-10 h-0.5 bg-blue-500/80 animate-pulse" />
          )}
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-sm">
              <thead>
                <tr className="border-b border-neutral-800 bg-neutral-900/80 text-[10px] uppercase tracking-wider text-neutral-400">
                  <th className="p-4 w-10"></th>
                  <th className="p-4 w-10">
                    <input
                      ref={headerCheckboxRef}
                      type="checkbox"
                      disabled={selectAllLoading && !hasSelection}
                      onChange={() => void toggleSelectAll()}
                      title={
                        hasSelection
                          ? 'Click to deselect all'
                          : selectAllLoading
                            ? 'Selecting all matching leads…'
                            : 'Select all matching leads'
                      }
                      className="rounded border-neutral-700 bg-neutral-800 text-blue-600 disabled:opacity-50"
                    />
                  </th>
                  <th className="p-4">Title</th>
                  <th className="p-4">First Name</th>
                  <th className="p-4">Last Name</th>
                  <th className="p-4">Email</th>
                  <th className="p-4">Phone</th>
                  <th className="p-4 text-center">Emp.</th>
                  <th className="p-4 text-center text-amber-500">Adv.</th>
                  <th className="p-4">Status</th>
                  <th className="p-4 text-center">Note</th>
                  <th className="p-4 text-center text-blue-500">Veri</th>
                  <th className="p-4 text-center text-purple-500">Paid</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-800/50">
                {loading ? (
                   <tr><td colSpan={13} className="p-8 text-center"><Loader2 className="w-6 h-6 animate-spin mx-auto" /></td></tr>
                ) : leads.length === 0 ? (
                  <tr><td colSpan={13} className="p-8 text-center text-neutral-500 uppercase font-bold text-xs">No leads found</td></tr>
                ) : (
                  leads.map((lead) => (
                    <AdminLeadTableRow
                      key={lead.id}
                      lead={lead}
                      expanded={expandedId === lead.id}
                      selected={selectedLeads.has(lead.id)}
                      onToggleExpand={() =>
                        expandedId === lead.id ? closeLeadDetail() : void openLeadDetail(lead.id)
                      }
                      onToggleSelect={() => toggleSelect(lead.id)}
                      onCopyPhone={(phone) => {
                        void navigator.clipboard.writeText(phone)
                        setNotification({ message: 'COPIED', type: 'success' })
                        setTimeout(() => setNotification(null), 1000)
                      }}
                      onVerifiedChange={(checked) =>
                        updateLead(lead.id, { verifiedSale: checked }, true)
                      }
                      onPaidChange={(checked) =>
                        updateLead(lead.id, { paymentReceived: checked }, true)
                      }
                    />
                  ))
                )}
              </tbody>
            </table>
          </div>
          {!loading && (
            <div className="bg-neutral-900/80 border-t border-neutral-800 p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div className="text-[10px] text-neutral-500 font-bold uppercase">
                {leads.length > 0 ? (
                  <>
                    Showing {pageStart}–{pageEnd}
                    {totalLeads != null ? (
                      <> of {totalLeads.toLocaleString()}</>
                    ) : countLoading ? (
                      <> · counting…</>
                    ) : (
                      <>+</>
                    )}
                    {' '}
                    · {pageSize} per page · Page {currentPage}
                    {totalPages > 1 ? ` of ${totalPages}` : ''}
                  </>
                ) : (
                  <>No leads · {pageSize} per page</>
                )}
              </div>
              {(canGoPrev || canGoNext) && (
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    disabled={!canGoPrev || pageLoading}
                    onClick={() => setCurrentPage((prev) => Math.max(1, prev - 1))}
                    className="px-4 py-1.5 bg-neutral-800 hover:bg-neutral-700 disabled:opacity-30 rounded text-[10px] font-black border border-neutral-700"
                  >
                    PREV
                  </button>
                  <span className="text-[10px] text-neutral-400 font-black px-1">
                    {currentPage}
                    {totalPages > 1 ? ` / ${totalPages}` : ''}
                  </span>
                  <button
                    type="button"
                    disabled={!canGoNext || pageLoading}
                    onClick={() => setCurrentPage((prev) => prev + 1)}
                    className="px-4 py-1.5 bg-blue-600 hover:bg-blue-700 disabled:opacity-30 rounded text-[10px] font-black border border-blue-500"
                  >
                    NEXT
                  </button>
                </div>
              )}
            </div>
          )}
        </div>

        <AnimatePresence>
        {expandedId && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
            <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.95 }} className="w-full max-w-2xl bg-neutral-900 border border-neutral-800 rounded-3xl shadow-2xl p-8">
              <div className="flex justify-between items-center mb-6">
                <h3 className="text-xl font-black text-white uppercase tracking-tight flex items-center gap-3"><MessageSquare className="w-6 h-6 text-blue-500" /> LEAD DETAILS</h3>
                <button type="button" onClick={closeLeadDetail} className="w-10 h-10 flex items-center justify-center rounded-full bg-neutral-800 hover:bg-red-500 text-white transition-all font-bold">×</button>
              </div>
              {detailLoading ? (
                <div className="py-12 flex justify-center">
                  <Loader2 className="w-8 h-8 animate-spin text-blue-500" />
                </div>
              ) : (
              <div className="grid md:grid-cols-2 gap-8">
                <div className="space-y-4">
                  <p className="text-[10px] text-neutral-500 uppercase font-black tracking-widest">INTERNAL REMARKS</p>
                  <textarea
                    value={detailRemarks}
                    onChange={(e) => {
                      const v = e.target.value
                      updateLead(expandedId!, { remarks: v })
                      setExpandedDetail((d) => (d ? { ...d, remarks: v } : d))
                    }}
                    placeholder="ADD NOTES..."
                    className="w-full bg-neutral-950 p-5 rounded-2xl border border-neutral-800 text-neutral-300 text-sm min-h-[150px] focus:ring-2 focus:ring-blue-500/20 outline-none resize-none transition-all"
                  />
                  <button type="button" onClick={() => forceSave(expandedId!)} className="w-full bg-blue-600 hover:bg-blue-700 text-white py-3 rounded-xl text-xs font-black uppercase tracking-widest transition-all">FORCE SAVE</button>
                </div>
                <div className="space-y-6">
                  <div><p className="text-[10px] text-neutral-500 uppercase font-black mb-1">ASSIGNED AGENT</p><p className="text-white font-bold">{expandedDetail?.assignedTo?.name || leads.find(l => l.id === expandedId)?.assignedTo?.name || 'NONE'}</p></div>
                  <div>
                    <p className="text-[10px] text-neutral-500 uppercase font-black mb-1">EMAIL</p>
                    <p className="text-white text-sm normal-case">{leads.find(l => l.id === expandedId)?.email || '-'}</p>
                  </div>
                  <div>
                    <p className="text-[10px] text-neutral-500 uppercase font-black mb-1">ADDRESS</p>
                    <p className="text-white text-sm leading-relaxed normal-case">
                      {[
                        expandedDetail?.addressLine1,
                        expandedDetail?.addressLine2,
                        expandedDetail?.addressLine3,
                        expandedDetail?.addressLine4,
                      ].filter(Boolean).join(', ') || expandedDetail?.address || '-'}
                      <br />
                      {expandedDetail?.postCode || ''}
                    </p>
                  </div>
                </div>
              </div>
              )}
            </motion.div>
          </div>
        )}
        </AnimatePresence>
      </main>

      <AnimatePresence>
        {notification && (
          <motion.div initial={{ opacity: 0, y: 50, x: '-50%' }} animate={{ opacity: 1, y: 0, x: '-50%' }} exit={{ opacity: 0, y: 50, x: '-50%' }} className={`fixed bottom-8 left-1/2 z-[100] px-8 py-4 rounded-full shadow-2xl border flex items-center gap-4 backdrop-blur-2xl ${notification.type === 'success' ? 'bg-emerald-500/20 border-emerald-500/30 text-emerald-400' : 'bg-amber-500/20 border-amber-500/30 text-amber-400'}`}>
            <div className={`w-2 h-2 rounded-full animate-pulse ${notification.type === 'success' ? 'bg-emerald-400' : 'bg-amber-400'}`} />
            <span className="text-[10px] font-black uppercase tracking-widest">{notification.message}</span>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
