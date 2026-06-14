'use client'

import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { useSearchParams } from 'next/navigation'
import Navigation from '@/components/Navigation'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Upload,
  Loader2,
  MessageSquare,
  Search,
  Filter,
  Trash2,
  TrendingUp,
  Users,
  ClipboardList,
  Save,
  FileText,
  Pencil,
  UserMinus,
} from 'lucide-react'
import EmployeeIntakeFormEditor from '@/components/employee/EmployeeIntakeFormEditor'
import { parseEmployeeIntakeForm, type EmployeeIntakeForm } from '@/lib/employee-intake-form'
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
import DispositionSelect from '@/components/employee/DispositionSelect'

type Employee = { id: string; name: string; email: string }

type LeadImportBatch = {
  id: string
  fileName: string
  fileUrl: string | null
  createdAt: string
  leadCount: number
}
type Lead = AdminLeadRow & {
  assignedToId?: string | null
  remarks?: string | null
  callbackAt?: string | null
}

type LeadDetail = {
  title: string | null
  firstName: string | null
  lastName: string | null
  email: string | null
  phone: string
  disposition: string
  callbackAt: string | null
  verifiedSale?: boolean
  paymentReceived?: boolean
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

const FILTER_DISPOSITIONS = ['All', ...LEAD_DISPOSITIONS]
const EDIT_DISPOSITIONS = LEAD_DISPOSITIONS

export default function AdminLeadsPage() {
  const searchParams = useSearchParams()
  const [leads, setLeads] = useState<Lead[]>([])
  const [employees, setEmployees] = useState<Employee[]>([])
  const [selectedLeads, setSelectedLeads] = useState<Set<string>>(new Set())
  const [selectedEmployeeId, setSelectedEmployeeId] = useState('')
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [uploading, setUploading] = useState(false)
  const [assigning, setAssigning] = useState(false)
  const [unassigning, setUnassigning] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [loading, setLoading] = useState(true)
  const [pageLoading, setPageLoading] = useState(false)
  const [searchTerm, setSearchTerm] = useState('')
  const [filterDisposition, setFilterDisposition] = useState('All')
  /** '' = all, 'unassigned' = no assignee, else employee user id */
  const [filterEmployeeId, setFilterEmployeeId] = useState('')
  /** '' = none selected (no query), 'none' = legacy pool, else import batch id */
  const [filterImportId, setFilterImportId] = useState('none')
  const [leadImports, setLeadImports] = useState<LeadImportBatch[]>([])
  const [legacyImportCount, setLegacyImportCount] = useState(0)
  const [importsLoading, setImportsLoading] = useState(true)
  const [batchActionLoading, setBatchActionLoading] = useState(false)
  const importFilterInitializedRef = useRef(false)
  const normalizedUnassignedRef = useRef(false)
  const employeeFilterFromUrlRef = useRef(false)
  const [leadsInitReady, setLeadsInitReady] = useState(false)
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
  const [intakeDraft, setIntakeDraft] = useState<EmployeeIntakeForm | null>(null)
  const [savingIntake, setSavingIntake] = useState(false)

  const saveQueueRef = useRef(new LeadSaveQueue())
  const lastSavedIntakeJson = useRef<string | null>(null)
  const selectAllAbortRef = useRef<AbortController | null>(null)
  const headerCheckboxRef = useRef<HTMLInputElement>(null)
  const fetchSeqRef = useRef(0)
  const countSeqRef = useRef(0)
  const pausePollRef = useRef(false)
  const leadsReadyRef = useRef(false)
  const selectedLeadsRef = useRef(selectedLeads)
  useEffect(() => {
    selectedLeadsRef.current = selectedLeads
  }, [selectedLeads])

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
      if (overrides?.unassignedOnly) {
        params.set('unassignedOnly', 'true')
      } else if (filterEmployeeId === 'unassigned') {
        params.set('unassignedOnly', 'true')
      } else if (filterEmployeeId) {
        params.set('assignedToId', filterEmployeeId)
      }
      if (overrides?.idsOnly) params.set('idsOnly', 'true')
      if (overrides?.countOnly) params.set('countOnly', 'true')
      if (filterImportId) params.set('importId', filterImportId)
      if (showSelectedOnly && selectedLeadsRef.current.size > 0) {
        params.set('ids', Array.from(selectedLeadsRef.current).join(','))
      }
      return params
    },
    [currentPage, pageSize, searchTerm, filterDisposition, filterEmployeeId, filterImportId, showSelectedOnly]
  )

  const fetchLegacyLeadCount = useCallback(async () => {
    const params = new URLSearchParams({ countOnly: 'true', importId: 'none' })
    const res = await fetch(`/api/admin/leads?${params.toString()}`, {
      cache: 'no-store',
      credentials: 'include',
    })
    const data = await res.json().catch(() => ({}))
    return res.ok && typeof data.total === 'number' ? data.total : null
  }, [])

  const pickDefaultImportFilter = useCallback(
    (imports: LeadImportBatch[], legacyCount: number, current: string) => {
      if (current === 'none') return 'none'
      if (current && current !== 'none' && imports.some((i) => i.id === current)) {
        return current
      }
      // Default to the newest import batch so fresh uploads are ready to assign.
      if (imports.length > 0) return imports[0].id
      if (legacyCount > 0) return 'none'
      return 'none'
    },
    []
  )

  const fetchLeadImports = useCallback(
    async (opts?: { reconcileFilter?: boolean }) => {
      setImportsLoading(true)
      try {
        const res = await fetch('/api/admin/lead-imports', {
          cache: 'no-store',
          credentials: 'include',
        })
        const data = await res.json().catch(() => ({}))

        const imports: LeadImportBatch[] = Array.isArray(data.imports)
          ? (data.imports as LeadImportBatch[])
          : []
        let legacyCount =
          typeof data.legacyCount === 'number' ? data.legacyCount : 0

        if (!res.ok || legacyCount === 0) {
          const fallbackCount = await fetchLegacyLeadCount()
          if (fallbackCount != null) legacyCount = fallbackCount
        }

        if (res.ok && Array.isArray(data.imports)) {
          setLeadImports(imports)
        } else {
          setLeadImports(imports)
          if (data.importsReady === false) {
            setNotification({
              message:
                'New upload batches need a one-time DB update. Existing leads still work — run: npx prisma generate && npx prisma db push',
              type: 'warn',
            })
          }
        }

        setLegacyImportCount(legacyCount)

        if (opts?.reconcileFilter || !importFilterInitializedRef.current) {
          setFilterImportId((prev) => {
            const next = pickDefaultImportFilter(imports, legacyCount, prev)
            importFilterInitializedRef.current = true
            return next
          })
        }
      } finally {
        setImportsLoading(false)
      }
    },
    [fetchLegacyLeadCount, pickDefaultImportFilter]
  )

  const selectedImportBatch = useMemo(
    () => leadImports.find((i) => i.id === filterImportId) ?? null,
    [leadImports, filterImportId]
  )

  const isNamedImportBatch = Boolean(selectedImportBatch)

  const handleRenameImportBatch = async () => {
    if (!selectedImportBatch || batchActionLoading) return
    const nextName = window.prompt('Rename import batch', selectedImportBatch.fileName)?.trim()
    if (!nextName || nextName === selectedImportBatch.fileName) return

    setBatchActionLoading(true)
    try {
      const res = await fetch(`/api/admin/lead-imports/${selectedImportBatch.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ fileName: nextName }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setNotification({
          message: typeof data.error === 'string' ? data.error : 'Could not rename batch',
          type: 'warn',
        })
        return
      }
      await fetchLeadImports({ reconcileFilter: true })
      setNotification({ message: `Renamed to "${nextName}"`, type: 'success' })
    } finally {
      setBatchActionLoading(false)
    }
  }

  const handleDeleteImportBatch = async () => {
    if (!selectedImportBatch || batchActionLoading) return
    const count = selectedImportBatch.leadCount
    const label = selectedImportBatch.fileName
    if (
      !confirm(
        `Delete "${label}" and all ${count.toLocaleString()} lead(s) in this batch? This cannot be undone.`
      )
    ) {
      return
    }

    setBatchActionLoading(true)
    pausePollRef.current = true
    try {
      const res = await fetch(`/api/admin/lead-imports/${selectedImportBatch.id}`, {
        method: 'DELETE',
        credentials: 'include',
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setNotification({
          message: typeof data.error === 'string' ? data.error : 'Could not delete batch',
          type: 'warn',
        })
        return
      }

      deselectAll()
      setFilterImportId('none')
      importFilterInitializedRef.current = false
      setTotalLeads(null)
      setCurrentPage(1)
      await fetchLeadImports({ reconcileFilter: true })
      setNotification({
        message: `Deleted "${label}" (${data.deletedLeadCount ?? 0} leads removed)`,
        type: 'success',
      })
    } finally {
      setBatchActionLoading(false)
      pausePollRef.current = false
    }
  }

  const fetchLeadCount = useCallback(async () => {
    if (!showSelectedOnly && !filterImportId) {
      setTotalLeads(null)
      setTotalPages(1)
      return
    }
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
  }, [buildLeadsQuery, pageSize, showSelectedOnly, selectedIdsKey, filterImportId])

  const fetchLeads = useCallback(
    async (opts?: { silent?: boolean; page?: number; refreshCount?: boolean }) => {
      if (!showSelectedOnly && !filterImportId) {
        setLeads([])
        setTotalLeads(null)
        setTotalPages(1)
        setHasMore(false)
        setLoading(false)
        setPageLoading(false)
        return
      }
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
    [buildLeadsQuery, currentPage, fetchLeadCount, showSelectedOnly, selectedIdsKey, filterImportId]
  )

  const fetchEmployees = useCallback(async () => {
    try {
      if (typeof sessionStorage !== 'undefined') {
        const raw = sessionStorage.getItem(EMPLOYEES_CACHE_KEY)
        if (raw) {
          const cached = JSON.parse(raw) as { ts: number; employees: Employee[] }
          if (Date.now() - cached.ts < EMPLOYEES_CACHE_MS && cached.employees?.length) {
            setEmployees(
              [...cached.employees].sort((a, b) => a.name.localeCompare(b.name))
            )
            return
          }
        }
      }
      const empRes = await fetch('/api/admin/employees', { cache: 'no-store', credentials: 'include' })
      const empData = await empRes.json()
      if (empData.employees) {
        const slim: Employee[] = empData.employees
          .map((e: Employee) => ({
            id: e.id,
            name: e.name,
            email: e.email,
          }))
          .sort((a: Employee, b: Employee) => a.name.localeCompare(b.name))
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
    if (employeeFilterFromUrlRef.current) return
    const fromUrl =
      searchParams.get('employee')?.trim() ||
      searchParams.get('assignedToId')?.trim() ||
      ''
    if (fromUrl) {
      setFilterEmployeeId(fromUrl)
      employeeFilterFromUrlRef.current = true
    }
  }, [searchParams])

  useEffect(() => {
    void (async () => {
      await Promise.all([fetchEmployees(), fetchLeadImports()])
      if (!normalizedUnassignedRef.current) {
        normalizedUnassignedRef.current = true
        try {
          const res = await fetch('/api/admin/leads/normalize-unassigned', {
            method: 'POST',
            credentials: 'include',
          })
          const data = await res.json().catch(() => ({}))
          if (res.ok && typeof data.repairedCount === 'number' && data.repairedCount > 0) {
            setTotalLeads(null)
            setNotification({
              message: `Repaired ${data.repairedCount} unassigned lead(s) — disposition set to New`,
              type: 'success',
            })
          }
        } catch {
          /* non-blocking repair */
        }
      }
      setLeadsInitReady(true)
    })()
  }, [fetchEmployees, fetchLeadImports])

  useEffect(() => {
    if (!leadsInitReady) return
    void fetchLeads()
  }, [fetchLeads, leadsInitReady])

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

  const activeEmployeeFilterLabel = useMemo(() => {
    if (filterEmployeeId === 'unassigned') return 'Unassigned (New only)'
    if (filterEmployeeId) {
      return employees.find((e) => e.id === filterEmployeeId)?.name ?? 'Selected employee'
    }
    return null
  }, [filterEmployeeId, employees])

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
          fileName: file.name,
          sourceFileName: file.name,
        }),
      })

      let result: {
        success?: boolean
        error?: string
        createdCount?: number
        skippedCount?: number
        importId?: string
        fileName?: string
      }
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
      await fetchLeadImports({ reconcileFilter: false })
      if (result.importId) {
        setFilterImportId(result.importId)
        importFilterInitializedRef.current = true
        setTotalLeads(null)
        setCurrentPage(1)
        deselectAll()
      } else {
        setTotalLeads(null)
        setCurrentPage(1)
      }
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
    if (selectedLeads.size === 0 || assigning || unassigning) return
    if (!selectedEmployeeId) {
      setNotification({ message: 'Select an employee before assigning leads.', type: 'warn' })
      return
    }
    const ids = Array.from(selectedLeads)
    const employee = employees.find((e) => e.id === selectedEmployeeId)
    const fromEmployeeName =
      filterEmployeeId && filterEmployeeId !== 'unassigned'
        ? employees.find((e) => e.id === filterEmployeeId)?.name
        : null
    const isTransfer = Boolean(
      fromEmployeeName && fromEmployeeName !== employee?.name
    )
    setAssigning(true)
    pausePollRef.current = true
    setLeads((prev) =>
      prev.map((l) =>
        ids.includes(l.id)
          ? {
              ...l,
              assignedToId: selectedEmployeeId,
              assignedTo: employee ? { name: employee.name } : l.assignedTo,
            }
          : l
      )
    )
    try {
      const res = await fetch('/api/admin/leads', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ leadIds: ids, assignedToId: selectedEmployeeId }),
      })
      const payload = await res.json().catch(() => ({}))
      const updatedCount =
        typeof payload.updatedCount === 'number' ? payload.updatedCount : 0
      const targetName = payload.assignedToName ?? employee?.name ?? 'employee'
      if (res.ok && updatedCount > 0) {
        deselectAll()
        setTotalLeads(null)
        await fetchLeads()
        void fetchLeadImports()
        const partial =
          typeof payload.requestedCount === 'number' &&
          updatedCount < payload.requestedCount
        setNotification({
          message: partial
            ? `${isTransfer ? 'Transferred' : 'Assigned'} ${updatedCount} of ${payload.requestedCount} selected lead(s)${isTransfer ? ` from ${fromEmployeeName} to ${targetName}` : ` to ${targetName}`}. Some selections were stale — deselect and re-select from the current batch.`
            : isTransfer
              ? `Transferred ${updatedCount} lead(s) from ${fromEmployeeName} to ${targetName}`
              : `Assigned ${updatedCount} lead(s) to ${targetName}`,
          type: partial ? 'warn' : 'success',
        })
      } else {
        await fetchLeads()
        setNotification({
          message:
            payload.error ||
            (updatedCount === 0
              ? 'No leads were assigned. Deselect all, select leads from the current import batch, then try again.'
              : 'Failed to assign leads'),
          type: 'warn',
        })
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

  const handleUnassign = async () => {
    if (selectedLeads.size === 0 || assigning || unassigning) return
    const count = selectedLeads.size
    if (
      !confirm(
        `Unassign ${count.toLocaleString()} lead(s)? They will return to the unassigned pool and leave the current employee's CRM board.`
      )
    ) {
      return
    }

    const ids = Array.from(selectedLeads)
    setUnassigning(true)
    pausePollRef.current = true
    setLeads((prev) =>
      prev.map((l) =>
        ids.includes(l.id)
          ? { ...l, assignedToId: null, assignedTo: null }
          : l
      )
    )
    try {
      const res = await fetch('/api/admin/leads', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ leadIds: ids, unassign: true }),
      })
      const payload = await res.json().catch(() => ({}))
      const updatedCount =
        typeof payload.updatedCount === 'number' ? payload.updatedCount : 0
      if (res.ok && updatedCount > 0) {
        deselectAll()
        setTotalLeads(null)
        await fetchLeads()
        void fetchLeadImports()
        const partial =
          typeof payload.requestedCount === 'number' &&
          updatedCount < payload.requestedCount
        setNotification({
          message: partial
            ? `Unassigned ${updatedCount} of ${payload.requestedCount} selected lead(s). Some selections were stale.`
            : `Unassigned ${updatedCount} lead(s) — returned to the unassigned pool`,
          type: partial ? 'warn' : 'success',
        })
      } else {
        await fetchLeads()
        setNotification({
          message:
            payload.error ||
            (updatedCount === 0
              ? 'No leads were unassigned. Deselect all and try again.'
              : 'Failed to unassign leads'),
          type: 'warn',
        })
      }
    } catch (e) {
      console.error(e)
      await fetchLeads()
      setNotification({ message: 'Failed to unassign leads', type: 'warn' })
    } finally {
      pausePollRef.current = false
      setUnassigning(false)
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
    if (!filterImportId) {
      setNotification({
        message: 'Select an import batch first (top dropdown), then use AUTO SELECT.',
        type: 'warn',
      })
      return
    }

    setPageLoading(true)
    pausePollRef.current = true
    try {
      // Fresh assignable pool only: no employee, disposition New, active import batch — ignore table filters.
      const params = new URLSearchParams({
        page: '1',
        pageSize: String(count),
        idsOnly: 'true',
        unassignedOnly: 'true',
        disposition: LEAD_DISPOSITIONS[0],
        importId: filterImportId,
      })
      const res = await fetch(`/api/admin/leads?${params.toString()}`, {
        cache: 'no-store',
        credentials: 'include',
      })
      const data = await res.json().catch(() => ({}))
      const ids: string[] = res.ok && Array.isArray(data.ids) ? data.ids : []
      const poolTotal = typeof data.total === 'number' ? data.total : ids.length
      const batchLabel =
        filterImportId === 'none'
          ? 'Existing leads'
          : selectedImportBatch?.fileName ?? 'this batch'

      setSelectedLeads(new Set(ids))
      setBulkSelectAll(false)
      setCommonQty('')
      setNotification({
        message:
          ids.length > 0
            ? `Selected ${ids.length} unassigned · New lead(s) from ${poolTotal.toLocaleString()} in "${batchLabel}" (newest first)`
            : `No unassigned · New leads in "${batchLabel}" — import fresh data or run repair`,
        type: ids.length > 0 ? 'success' : 'warn',
      })
    } finally {
      setPageLoading(false)
      pausePollRef.current = false
    }
  }

  const saveLeadPatch = useCallback(
    async (leadId: string, body: Record<string, unknown>) => {
      const res = await fetch(`/api/admin/leads/${leadId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        credentials: 'include',
      })
      const data = await res.json().catch(() => ({}))
      if (res.ok && data.lead) {
        const saved = data.lead as LeadDetail
        setLeads((prev) =>
          prev.map((l) =>
            l.id === leadId
              ? {
                  ...l,
                  title: saved.title ?? l.title,
                  firstName: saved.firstName ?? l.firstName,
                  lastName: saved.lastName ?? l.lastName,
                  email: saved.email ?? l.email,
                  disposition: saved.disposition ?? l.disposition,
                  remarks: saved.remarks ?? l.remarks,
                  verifiedSale: saved.verifiedSale ?? l.verifiedSale,
                  paymentReceived: saved.paymentReceived ?? l.paymentReceived,
                  callbackAt:
                    saved.callbackAt !== undefined ? saved.callbackAt : l.callbackAt,
                }
              : l
          )
        )
        setExpandedDetail((d) =>
          d && expandedId === leadId
            ? {
                ...d,
                ...saved,
                callbackAt: saved.callbackAt ?? d.callbackAt,
              }
            : d
        )
      }
      return { ok: res.ok, status: res.status, data }
    },
    [expandedId]
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

  const toLocalDatetimeInput = (iso: string | null | undefined) => {
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

  const seedIntakeFromLead = useCallback((leadId: string, rawForm: unknown) => {
    const row = leads.find((l) => l.id === leadId)
    const parsed = parseEmployeeIntakeForm(rawForm ?? null)
    const resolvedName = [row?.firstName, row?.lastName].filter(Boolean).join(' ').trim()
    if (!parsed.fullName && resolvedName) parsed.fullName = resolvedName
    if (!parsed.callingNumber && row?.phone) parsed.callingNumber = row.phone
    if (!parsed.emailAddress && row?.email) parsed.emailAddress = row.email ?? ''
    if (parsed.whatsappSameAsCalling && !parsed.whatsappNumber && parsed.callingNumber) {
      parsed.whatsappNumber = parsed.callingNumber
    }
    setIntakeDraft(parsed)
    lastSavedIntakeJson.current = JSON.stringify(parsed)
  }, [leads])

  const persistIntake = useCallback(
    async (leadId: string, form: EmployeeIntakeForm) => {
      setSavingIntake(true)
      try {
        const res = await fetch(`/api/admin/leads/${leadId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ employeeIntakeForm: form }),
        })
        const data = await res.json().catch(() => ({}))
        if (!res.ok) {
          setNotification({
            message: typeof data.error === 'string' ? data.error : 'Failed to save intake form',
            type: 'warn',
          })
          return
        }
        if (data.lead) {
          const remarks = data.lead.remarks as string | null | undefined
          setLeads((prev) =>
            prev.map((l) => (l.id === leadId ? { ...l, remarks: remarks ?? l.remarks } : l))
          )
          setExpandedDetail((d) => (d ? { ...d, remarks: remarks ?? d.remarks } : d))
          lastSavedIntakeJson.current = JSON.stringify(form)
        }
      } finally {
        setSavingIntake(false)
      }
    },
    []
  )

  const openLeadDetail = useCallback(
    async (leadId: string) => {
      setExpandedId(leadId)
      setExpandedDetail(null)
      setIntakeDraft(null)
      setDetailLoading(true)
      pausePollRef.current = true
      try {
        const res = await fetch(`/api/admin/leads/${leadId}`, {
          cache: 'no-store',
          credentials: 'include',
        })
        const data = await res.json().catch(() => ({}))
        if (res.ok && data.lead) {
          setExpandedDetail(data.lead as LeadDetail)
          seedIntakeFromLead(leadId, data.lead.employeeIntakeForm)
        }
      } finally {
        setDetailLoading(false)
      }
    },
    [seedIntakeFromLead]
  )

  const closeLeadDetail = () => {
    setExpandedId(null)
    setExpandedDetail(null)
    setIntakeDraft(null)
    lastSavedIntakeJson.current = null
    pausePollRef.current = false
  }

  useEffect(() => {
    if (!expandedId || !intakeDraft) return
    const snapshot = JSON.stringify(intakeDraft)
    if (snapshot === lastSavedIntakeJson.current) return
    const t = setTimeout(() => {
      void persistIntake(expandedId, intakeDraft)
    }, 1200)
    return () => clearTimeout(t)
  }, [expandedId, intakeDraft, persistIntake])

  const forceSaveIntake = () => {
    if (!expandedId || !intakeDraft) return
    void persistIntake(expandedId, intakeDraft)
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
              {ADMIN_LEADS_PAGE_SIZE} leads per page · filter by import file to load only that batch
            </p>
            <p className="text-neutral-500 text-xs mt-2 normal-case">{LEAD_PHONE_HELP_TEXT}</p>
          </div>
          
          <div className="flex flex-col gap-4">
            <div className="flex flex-wrap items-center gap-3 lg:justify-end w-full">
              <div className="relative w-full sm:min-w-[280px] sm:flex-1 sm:max-w-xl">
                <FileText className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-blue-500" />
                <select
                  value={filterImportId}
                  aria-label="Select import file"
                  onChange={(e) => {
                    setTotalLeads(null)
                    setFilterImportId(e.target.value)
                    importFilterInitializedRef.current = true
                    setCurrentPage(1)
                    deselectAll()
                  }}
                  disabled={importsLoading && !filterImportId}
                  className="w-full bg-neutral-900 border border-blue-500/30 text-white rounded-lg pl-10 pr-4 py-2.5 text-sm appearance-none transition-all normal-case font-medium disabled:opacity-60"
                >
                  <option value="none">
                    Existing leads
                    {importsLoading
                      ? ' (loading…)'
                      : legacyImportCount > 0
                        ? ` (${legacyImportCount.toLocaleString()} leads)`
                        : ''}
                  </option>
                  {leadImports.map((imp) => (
                    <option key={imp.id} value={imp.id}>
                      {imp.fileName} ({imp.leadCount.toLocaleString()} leads ·{' '}
                      {new Date(imp.createdAt).toLocaleDateString()})
                    </option>
                  ))}
                </select>
              </div>

              {isNamedImportBatch && (
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => void handleRenameImportBatch()}
                    disabled={batchActionLoading}
                    title="Rename this import batch"
                    className="bg-neutral-900 hover:bg-neutral-800 disabled:opacity-50 text-neutral-300 hover:text-white px-3 py-2.5 rounded-lg text-xs font-bold border border-neutral-800 transition-all inline-flex items-center gap-1.5 normal-case"
                  >
                    {batchActionLoading ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <Pencil className="w-3.5 h-3.5" />
                    )}
                    Rename
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleDeleteImportBatch()}
                    disabled={batchActionLoading}
                    title="Delete this batch and all its leads"
                    className="bg-red-600/10 hover:bg-red-600 disabled:opacity-50 text-red-500 hover:text-white px-3 py-2.5 rounded-lg text-xs font-bold border border-red-600/20 transition-all inline-flex items-center gap-1.5"
                  >
                    <Trash2 className="w-3.5 h-3.5" /> Delete batch
                  </button>
                </div>
              )}
            </div>

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
                  {FILTER_DISPOSITIONS.map(d => <option key={d} value={d}>{d}</option>)}
                </select>
              </div>

              <div className="relative w-full sm:w-56">
                <Users className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-neutral-500" />
                <select
                  value={filterEmployeeId}
                  aria-label="Filter leads by assigned employee"
                  title="Filter by employee"
                  onChange={(e) => {
                    setTotalLeads(null)
                    setFilterEmployeeId(e.target.value)
                    setCurrentPage(1)
                    deselectAll()
                  }}
                  className="w-full bg-neutral-900 border border-neutral-800 text-white rounded-lg pl-10 pr-4 py-2 text-sm appearance-none transition-all"
                >
                  <option value="">All employees</option>
                  <option value="unassigned">Unassigned (New only)</option>
                  {employees.map((emp) => (
                    <option key={emp.id} value={emp.id}>
                      {emp.name}
                    </option>
                  ))}
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
                <select
                  value={selectedEmployeeId}
                  onChange={(e) => setSelectedEmployeeId(e.target.value)}
                  aria-label="Assign or transfer leads to employee"
                  title={
                    filterEmployeeId && filterEmployeeId !== 'unassigned'
                      ? 'Transfer selected leads to this employee'
                      : 'Assign selected leads to this employee'
                  }
                  className="bg-neutral-950 text-neutral-200 text-xs pl-3 pr-8 py-1.5 focus:outline-none rounded-md border border-neutral-800 max-w-[160px] uppercase"
                >
                  <option value="">
                    {filterEmployeeId && filterEmployeeId !== 'unassigned'
                      ? 'TRANSFER TO…'
                      : 'ASSIGN TO…'}
                  </option>
                  {employees.map((e) => (
                    <option key={e.id} value={e.id}>
                      {e.name}
                    </option>
                  ))}
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
                <button
                  type="button"
                  onClick={handleUnassign}
                  disabled={unassigning || assigning || selectedLeads.size === 0}
                  title="Remove employee assignment from selected leads"
                  className="bg-neutral-800 hover:bg-neutral-700 disabled:opacity-50 text-neutral-300 hover:text-white px-3 py-1.5 rounded-md text-xs font-bold border border-neutral-700 inline-flex items-center gap-1.5"
                >
                  {unassigning ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <UserMinus className="w-3.5 h-3.5" />
                  )}
                  UNASSIGN ({selectedLeads.size})
                </button>
                <button
                  onClick={handleAssign}
                  disabled={
                    assigning ||
                    unassigning ||
                    selectedLeads.size === 0 ||
                    !selectedEmployeeId
                  }
                  className="bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white px-3 py-1.5 rounded-md text-xs font-bold inline-flex items-center gap-1.5"
                >
                  {assigning && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                  {filterEmployeeId && filterEmployeeId !== 'unassigned'
                    ? `TRANSFER (${selectedLeads.size})`
                    : `ASSIGN (${selectedLeads.size})`}
                </button>
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
                ) : !filterImportId && !showSelectedOnly ? (
                  <tr>
                    <td colSpan={13} className="p-12 text-center text-neutral-500 normal-case">
                      <FileText className="w-10 h-10 mx-auto mb-3 text-blue-500/60" />
                      <p className="font-bold text-sm text-neutral-300">No lead batches yet</p>
                      <p className="text-xs mt-2 max-w-md mx-auto">
                        Upload a CSV or spreadsheet to create a batch. Existing database leads appear under
                        &quot;Existing leads&quot; when present.
                      </p>
                    </td>
                  </tr>
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
                      dispositionOptions={EDIT_DISPOSITIONS}
                      onDispositionChange={(nextDisposition) => {
                        const updates: Partial<Lead> = { disposition: nextDisposition }
                        if (nextDisposition !== 'Callback') updates.callbackAt = null
                        updateLead(lead.id, updates, true)
                      }}
                      hasIntakeData={!!lead.remarks?.trim()}
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
                    {activeEmployeeFilterLabel ? (
                      <> · Employee: {activeEmployeeFilterLabel}</>
                    ) : null}
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
          <div
            className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm"
            role="presentation"
            onMouseDown={(e) => {
              if (e.target === e.currentTarget) closeLeadDetail()
            }}
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="w-full max-w-4xl max-h-[92vh] overflow-y-auto bg-neutral-900 border border-neutral-800 rounded-3xl shadow-2xl p-6 sm:p-8"
              onMouseDown={(e) => e.stopPropagation()}
            >
              <div className="flex justify-between items-start gap-4 mb-6">
                <div>
                  <h3 className="text-xl font-black text-white uppercase tracking-tight flex items-center gap-3">
                    <MessageSquare className="w-6 h-6 text-blue-500" /> LEAD DETAILS
                  </h3>
                  <p className="text-xs text-neutral-500 mt-1 font-mono normal-case">
                    {(() => {
                      const l = leads.find((x) => x.id === expandedId)
                      return l
                        ? [l.firstName, l.lastName].filter(Boolean).join(' ') + ' · ' + l.phone
                        : ''
                    })()}
                  </p>
                </div>
                <div className="flex items-center gap-3 shrink-0">
                  {savingIntake && (
                    <span className="text-xs text-blue-400 flex items-center gap-1 normal-case">
                      <Loader2 className="w-3 h-3 animate-spin" /> Saving intake…
                    </span>
                  )}
                  <button
                    type="button"
                    onClick={closeLeadDetail}
                    className="w-10 h-10 flex items-center justify-center rounded-full bg-neutral-800 hover:bg-red-500 text-white transition-all font-bold"
                  >
                    ×
                  </button>
                </div>
              </div>
              {detailLoading ? (
                <div className="py-12 flex justify-center">
                  <Loader2 className="w-8 h-8 animate-spin text-blue-500" />
                </div>
              ) : (
              <>
              <div className="grid md:grid-cols-2 gap-8">
                <div className="space-y-4">
                  <div>
                    <p className="text-[10px] text-neutral-500 uppercase font-black mb-2">DISPOSITION</p>
                    <DispositionSelect
                      value={expandedDetail?.disposition ?? leads.find((l) => l.id === expandedId)?.disposition ?? 'New'}
                      options={EDIT_DISPOSITIONS}
                      onSelect={(nextDisposition) => {
                        const updates: Partial<Lead> = { disposition: nextDisposition }
                        if (nextDisposition !== 'Callback') updates.callbackAt = null
                        updateLead(expandedId!, updates, true)
                        setExpandedDetail((d) =>
                          d
                            ? {
                                ...d,
                                disposition: nextDisposition,
                                callbackAt: nextDisposition === 'Callback' ? d.callbackAt : null,
                              }
                            : d
                        )
                      }}
                    />
                  </div>
                  {(expandedDetail?.disposition ?? leads.find((l) => l.id === expandedId)?.disposition) ===
                    'Callback' && (
                    <div>
                      <p className="text-[10px] text-neutral-500 uppercase font-black mb-2">CALLBACK TIME</p>
                      <input
                        type="datetime-local"
                        value={toLocalDatetimeInput(
                          expandedDetail?.callbackAt ??
                            leads.find((l) => l.id === expandedId)?.callbackAt
                        )}
                        onChange={(e) => {
                          const nextIso = fromLocalDatetimeInput(e.target.value)
                          updateLead(expandedId!, { callbackAt: nextIso }, true)
                          setExpandedDetail((d) => (d ? { ...d, callbackAt: nextIso } : d))
                        }}
                        className="w-full bg-neutral-950 border border-neutral-800 rounded-lg px-3 py-2 text-sm text-white focus:ring-2 focus:ring-blue-500/20 outline-none"
                      />
                    </div>
                  )}
                  <p className="text-[10px] text-neutral-500 uppercase font-black tracking-widest">INTERNAL REMARKS</p>
                  <textarea
                    value={detailRemarks}
                    onChange={(e) => {
                      const v = e.target.value
                      updateLead(expandedId!, { remarks: v })
                      setExpandedDetail((d) => (d ? { ...d, remarks: v } : d))
                    }}
                    placeholder="ADD NOTES..."
                    className="w-full bg-neutral-950 p-5 rounded-2xl border border-neutral-800 text-neutral-300 text-sm min-h-[150px] focus:ring-2 focus:ring-blue-500/20 outline-none resize-none transition-all normal-case"
                  />
                  <button type="button" onClick={() => forceSave(expandedId!)} className="w-full bg-blue-600 hover:bg-blue-700 text-white py-3 rounded-xl text-xs font-black uppercase tracking-widest transition-all">FORCE SAVE</button>
                </div>
                <div className="space-y-4">
                  <div>
                    <p className="text-[10px] text-neutral-500 uppercase font-black mb-1">ASSIGNED AGENT</p>
                    <p className="text-white font-bold">
                      {expandedDetail?.assignedTo?.name ||
                        leads.find((l) => l.id === expandedId)?.assignedTo?.name ||
                        'NONE'}
                    </p>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <p className="text-[10px] text-neutral-500 uppercase font-black mb-1">FIRST NAME</p>
                      <input
                        type="text"
                        value={expandedDetail?.firstName ?? leads.find((l) => l.id === expandedId)?.firstName ?? ''}
                        onChange={(e) => {
                          const v = e.target.value
                          updateLead(expandedId!, { firstName: v })
                          setExpandedDetail((d) => (d ? { ...d, firstName: v } : d))
                        }}
                        className="w-full bg-neutral-950 border border-neutral-800 rounded-lg px-3 py-2 text-sm text-white normal-case focus:ring-2 focus:ring-blue-500/20 outline-none"
                      />
                    </div>
                    <div>
                      <p className="text-[10px] text-neutral-500 uppercase font-black mb-1">LAST NAME</p>
                      <input
                        type="text"
                        value={expandedDetail?.lastName ?? leads.find((l) => l.id === expandedId)?.lastName ?? ''}
                        onChange={(e) => {
                          const v = e.target.value
                          updateLead(expandedId!, { lastName: v })
                          setExpandedDetail((d) => (d ? { ...d, lastName: v } : d))
                        }}
                        className="w-full bg-neutral-950 border border-neutral-800 rounded-lg px-3 py-2 text-sm text-white normal-case focus:ring-2 focus:ring-blue-500/20 outline-none"
                      />
                    </div>
                  </div>
                  <div>
                    <p className="text-[10px] text-neutral-500 uppercase font-black mb-1">EMAIL</p>
                    <input
                      type="email"
                      value={expandedDetail?.email ?? leads.find((l) => l.id === expandedId)?.email ?? ''}
                      onChange={(e) => {
                        const v = e.target.value
                        updateLead(expandedId!, { email: v })
                        setExpandedDetail((d) => (d ? { ...d, email: v } : d))
                      }}
                      className="w-full bg-neutral-950 border border-neutral-800 rounded-lg px-3 py-2 text-sm text-white normal-case focus:ring-2 focus:ring-blue-500/20 outline-none"
                    />
                  </div>
                  <div>
                    <p className="text-[10px] text-neutral-500 uppercase font-black mb-1">PHONE</p>
                    <p className="text-white text-sm font-mono normal-case">
                      {expandedDetail?.phone ?? leads.find((l) => l.id === expandedId)?.phone ?? '-'}
                    </p>
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

              {intakeDraft && (
                <div className="mt-8 pt-8 border-t border-neutral-800 space-y-4 normal-case">
                  <h4 className="text-sm font-bold text-white flex items-center gap-2">
                    <ClipboardList className="w-5 h-5 text-blue-500" />
                    Lead intake form
                    <span className="text-[10px] font-normal text-neutral-500">
                      (same form employees use in CRM)
                    </span>
                  </h4>
                  <EmployeeIntakeFormEditor form={intakeDraft} setForm={setIntakeDraft} />
                  <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 pt-2">
                    <span className="text-[10px] text-neutral-500">
                      Intake saves automatically after about 1s without edits.
                    </span>
                    <button
                      type="button"
                      onClick={forceSaveIntake}
                      disabled={savingIntake}
                      className="bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white px-4 py-2 rounded-lg text-xs font-bold transition-all inline-flex items-center gap-2"
                    >
                      <Save className="w-3.5 h-3.5" />
                      Save intake now
                    </button>
                  </div>
                </div>
              )}
              </>
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
