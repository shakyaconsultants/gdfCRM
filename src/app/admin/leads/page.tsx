'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import Navigation from '@/components/Navigation'
import { motion, AnimatePresence } from 'framer-motion'
import { Upload, Check, Save, Loader2, ChevronDown, ChevronRight, MessageSquare, AlertTriangle, Search, Filter, Trash2, Copy, TrendingUp } from 'lucide-react'
import Papa from 'papaparse'
import { readSheet } from 'read-excel-file/browser'
import { LEAD_PHONE_HELP_TEXT, parseLeadPhoneForStorage } from '@/lib/phone'
import { LEAD_DISPOSITIONS } from '@/lib/lead-workflow'

type Employee = { id: string; name: string; email: string }
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
  assignedToId: string | null
  assignedTo: { name: string } | null
  assignedAdvisorId: string | null
  assignedAdvisor: { name: string } | null
  disposition: string
  remarks: string | null
  moveToAdvisor: boolean
  closedSale: boolean
  verifiedSale: boolean
  paymentReceived: boolean
  updatedAt: string
}

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
  const [totalLeads, setTotalLeads] = useState(0)
  const [totalPages, setTotalPages] = useState(1)
  const pageSize = 50
  const [displaySearchTerm, setDisplaySearchTerm] = useState('')
  const [showSelectedOnly, setShowSelectedOnly] = useState(false)

  const timeoutRef = useRef<NodeJS.Timeout | null>(null)
  const fetchSeqRef = useRef(0)
  const pausePollRef = useRef(false)
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
    }) => {
      const params = new URLSearchParams()
      params.set('page', String(overrides?.page ?? currentPage))
      params.set('pageSize', String(overrides?.pageSize ?? pageSize))
      if (searchTerm) params.set('search', searchTerm)
      if (filterDisposition !== 'All') params.set('disposition', filterDisposition)
      if (overrides?.unassignedOnly) params.set('unassignedOnly', 'true')
      if (overrides?.idsOnly) params.set('idsOnly', 'true')
      if (showSelectedOnly && selectedLeadsRef.current.size > 0) {
        params.set('ids', Array.from(selectedLeadsRef.current).join(','))
      }
      return params
    },
    [currentPage, pageSize, searchTerm, filterDisposition, showSelectedOnly]
  )

  const toRecordRows = async (file: File): Promise<Record<string, unknown>[]> => {
    const lowerName = file.name.toLowerCase()
    if (lowerName.endsWith('.csv')) {
      const text = await file.text()
      const parsed = Papa.parse<Record<string, unknown>>(text, {
        header: true,
        skipEmptyLines: true,
      })
      if (parsed.errors.length > 0) {
        throw new Error(parsed.errors[0]?.message || 'Failed to parse CSV')
      }
      return parsed.data
    }

    const rows = await readSheet(file)
    if (!rows.length) return []
    const header = rows[0].map((x) => String(x ?? '').trim())
    return rows.slice(1).map((row) => {
      const out: Record<string, unknown> = {}
      header.forEach((key, idx) => {
        out[key] = row[idx]
      })
      return out
    })
  }

  const fetchLeads = useCallback(
    async (opts?: { silent?: boolean; page?: number }) => {
      if (showSelectedOnly && selectedLeadsRef.current.size === 0) {
        setLeads([])
        setTotalLeads(0)
        setTotalPages(1)
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
        if (leadsData.leads) setLeads(leadsData.leads)
        if (typeof leadsData.total === 'number') setTotalLeads(leadsData.total)
        if (typeof leadsData.totalPages === 'number') setTotalPages(leadsData.totalPages)
      } finally {
        if (seq === fetchSeqRef.current) {
          setLoading(false)
          setPageLoading(false)
        }
      }
    },
    [buildLeadsQuery, currentPage, showSelectedOnly, selectedIdsKey]
  )

  const fetchEmployees = useCallback(async () => {
    try {
      const empRes = await fetch('/api/admin/employees', { cache: 'no-store', credentials: 'include' })
      const empData = await empRes.json()
      if (empData.employees) setEmployees(empData.employees)
    } catch {
      /* employees list is non-blocking */
    }
  }, [])

  useEffect(() => {
    void fetchEmployees()
  }, [fetchEmployees])

  useEffect(() => {
    void fetchLeads()
  }, [fetchLeads])

  useEffect(() => {
    const interval = setInterval(() => {
      if (pausePollRef.current) return
      void fetchLeads({ silent: true })
    }, 30000)
    return () => clearInterval(interval)
  }, [fetchLeads])

  useEffect(() => {
    const timer = setTimeout(() => {
      setSearchTerm(displaySearchTerm)
      setCurrentPage(1)
    }, 300)
    return () => clearTimeout(timer)
  }, [displaySearchTerm])

  const pageStart = totalLeads === 0 ? 0 : (currentPage - 1) * pageSize + 1
  const pageEnd = Math.min(currentPage * pageSize, totalLeads)
  const allFilteredSelected = totalLeads > 0 && selectedLeads.size === totalLeads

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    setUploading(true)
    try {
      const formData = new FormData()
      formData.append('file', file)
      const uploadRes = await fetch('/api/admin/upload', { method: 'POST', body: formData })
      const uploadData = await uploadRes.json()
      
      if (!uploadData.success) throw new Error(uploadData.error || 'Upload failed')

      try {
          const data = await toRecordRows(file)
          const parsedRows = data.map((row) => {
            const raw = row.phone ?? row.Phone ?? row.Number ?? ''
            return {
              title: row.title || row.Title || '',
              firstName: row.firstName || row.FirstName || row['First Name'] || '',
              lastName: row.lastName || row.LastName || row['Last Name'] || '',
              email: row.email || row.Email || row['E-mail'] || row['Email Address'] || '',
              addressLine1: row.addressLine1 || row['Address Line 1'] || row['Address 1'] || row.address1 || '',
              addressLine2: row.addressLine2 || row['Address Line 2'] || row['Address 2'] || row.address2 || '',
              addressLine3: row.addressLine3 || row['Address Line 3'] || row['Address 3'] || row.address3 || '',
              addressLine4: row.addressLine4 || row['Address Line 4'] || row['Address 4'] || row.address4 || '',
              address: row.address || row.Address || row['Full Address'] || '',
              postCode: row.postCode || row.PostCode || row['Post Code'] || '',
              phone: parseLeadPhoneForStorage(raw) ?? '',
              remarks: row.remarks || row.Remarks || '',
            }
          })
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
                  ? `No rows to import. ${droppedInvalidPhone} skipped (missing or invalid phone). ${LEAD_PHONE_HELP_TEXT}`
                  : 'No rows found with both a name and a valid phone.',
              type: 'warn',
            })
            return
          }

          const res = await fetch('/api/admin/leads', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              leads: formattedData,
              fileUrl: uploadData.result.secure_url,
            }),
          })
          const result = await res.json().catch(() => ({}))

          if (!res.ok || !result.success) {
            setNotification({
              message: typeof result.error === 'string' ? result.error : 'Import failed',
              type: 'warn',
            })
            return
          }

          const parts = [
            `Created ${result.createdCount} leads`,
            result.skippedCount > 0
              ? `skipped ${result.skippedCount} (duplicate or invalid)`
              : null,
            droppedInvalidPhone > 0
              ? `${droppedInvalidPhone} row(s) dropped (missing or invalid phone)`
              : null,
          ].filter(Boolean)
          setNotification({ message: `${parts.join('. ')}.`, type: 'success' })
          setCurrentPage(1)
          void fetchLeads({ page: 1 })
      } catch (parseErr: any) {
          setNotification({
            message: parseErr?.message ?? 'Failed to parse file',
            type: 'warn',
          })
      }
    } catch (err: any) {
      setNotification({ message: err.message, type: 'warn' })
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
        body: JSON.stringify({ leadIds: ids, assignedToId: selectedEmployeeId }),
      })
      const payload = await res.json().catch(() => ({}))
      if (res.ok) {
        setSelectedLeads(new Set())
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
        setSelectedLeads(new Set())
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
  }

  const toggleSelectAll = async () => {
    if (allFilteredSelected) {
      setSelectedLeads(new Set())
      return
    }

    setPageLoading(true)
    try {
      const params = buildLeadsQuery({ page: 1, pageSize: 5000, idsOnly: true })
      const res = await fetch(`/api/admin/leads?${params.toString()}`, {
        cache: 'no-store',
        credentials: 'include',
      })
      const data = await res.json().catch(() => ({}))
      if (res.ok && Array.isArray(data.ids)) {
        setSelectedLeads(new Set(data.ids))
        const capped = typeof data.total === 'number' && data.total > data.ids.length
        setNotification({
          message: capped
            ? `Selected ${data.ids.length} of ${data.total} matching leads (5,000 cap)`
            : `Selected ${data.ids.length} lead(s) matching filters`,
          type: 'success',
        })
      }
    } finally {
      setPageLoading(false)
    }
  }

  const handleAutoSelect = async () => {
    const count = Number(commonQty)
    if (isNaN(count) || count <= 0) return

    setPageLoading(true)
    try {
      const params = buildLeadsQuery({
        page: 1,
        pageSize: count,
        idsOnly: true,
        unassignedOnly: true,
      })
      const res = await fetch(`/api/admin/leads?${params.toString()}`, {
        cache: 'no-store',
        credentials: 'include',
      })
      const data = await res.json().catch(() => ({}))
      const ids: string[] = res.ok && Array.isArray(data.ids) ? data.ids : []

      setSelectedLeads(new Set(ids))
      setCommonQty('')
      setNotification({
        message:
          ids.length > 0
            ? `Selected ${ids.length} unassigned lead(s)`
            : 'No unassigned leads in this list — clear filters or import fresh data',
        type: ids.length > 0 ? 'success' : 'warn',
      })
    } finally {
      setPageLoading(false)
    }
  }

  const updateLead = async (id: string, updates: Partial<Lead>, immediate = false) => {
    setLeads(prev => prev.map(l => l.id === id ? { ...l, ...updates } : l))
    if (timeoutRef.current) clearTimeout(timeoutRef.current)
    const performSave = async () => {
      await fetch(`/api/admin/leads/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates)
      })
    }
    if (immediate) performSave()
    else timeoutRef.current = setTimeout(performSave, 1000)
  }

  const forceSave = (id: string) => {
    const lead = leads.find(l => l.id === id)
    if (lead) updateLead(id, { remarks: lead.remarks }, true)
  }

  return (
    <div className="min-h-screen bg-neutral-950 text-neutral-200 uppercase-control">
      <Navigation />
      
      <main className="max-w-[1600px] mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between mb-8 gap-6">
          <div>
            <h1 className="text-2xl font-bold text-white">Manage Leads</h1>
            <p className="text-neutral-400 text-sm mt-1 uppercase">Central command for lead distribution and upload.</p>
            <p className="text-neutral-500 text-xs mt-2 normal-case">{LEAD_PHONE_HELP_TEXT}</p>
          </div>
          
          <div className="flex flex-col gap-4">
            <div className="flex flex-wrap items-center gap-4 lg:justify-end">
              <div className="relative w-full sm:w-64">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-neutral-500" />
                <input 
                  type="text" 
                  placeholder="FIND NAME OR PHONE..."
                  value={displaySearchTerm}
                  onChange={e => setDisplaySearchTerm(e.target.value)}
                  className="w-full bg-neutral-900 border border-neutral-800 rounded-lg pl-10 pr-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/50 transition-all text-white uppercase"
                />
              </div>

              <div className="relative w-full sm:w-48">
                <Filter className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-neutral-500" />
                <select 
                  value={filterDisposition}
                  onChange={e => { setFilterDisposition(e.target.value); setCurrentPage(1) }}
                  className="w-full bg-neutral-900 border border-neutral-800 text-white rounded-lg pl-10 pr-4 py-2 text-sm appearance-none transition-all uppercase"
                >
                  {DISPOSITIONS.map(d => <option key={d} value={d}>{d}</option>)}
                </select>
              </div>

              <button
                onClick={() => { setShowSelectedOnly(!showSelectedOnly); setCurrentPage(1); }}
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
                {selectedLeads.size > 0 && (
                  <button onClick={() => { setSelectedLeads(new Set()); setShowSelectedOnly(false); }} className="bg-neutral-800 hover:bg-neutral-700 text-neutral-400 px-3 py-1.5 rounded-md text-xs font-bold border border-neutral-700 transition-colors">
                    CLEAR
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
                <input type="file" accept=".xlsx,.csv" onChange={handleFileUpload} className="absolute inset-0 opacity-0 cursor-pointer" disabled={uploading} />
              </div>
              
              <div className="flex items-center gap-2 bg-neutral-900 border border-neutral-800 rounded-lg p-1">
                <select value={selectedEmployeeId} onChange={e => setSelectedEmployeeId(e.target.value)} className="bg-neutral-950 text-neutral-200 text-xs pl-3 pr-8 py-1.5 focus:outline-none rounded-md border border-neutral-800 max-w-[140px] uppercase">
                  <option value="">EMPLOYEE...</option>
                  {employees.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}
                </select>
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
                  <th className="p-4 w-10"><input type="checkbox" checked={allFilteredSelected} onChange={() => void toggleSelectAll()} className="rounded border-neutral-700 bg-neutral-800 text-blue-600" /></th>
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
                  leads.map(lead => (
                    <motion.tr key={lead.id} initial={{ opacity: 0 }} animate={{ opacity: 1 }} className={`hover:bg-neutral-800/30 transition-colors ${expandedId === lead.id ? 'bg-neutral-800/20' : ''}`}>
                      <td className="p-4 text-center"><button onClick={() => setExpandedId(expandedId === lead.id ? null : lead.id)}>{expandedId === lead.id ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}</button></td>
                      <td className="p-4"><input type="checkbox" checked={selectedLeads.has(lead.id)} onChange={() => toggleSelect(lead.id)} className="rounded border-neutral-700 bg-neutral-800" /></td>
                      <td className="p-4 text-neutral-400 text-xs">{lead.title || '-'}</td>
                      <td className="p-4 font-bold text-white">{lead.firstName}</td>
                      <td className="p-4 text-neutral-300">{lead.lastName || '-'}</td>
                      <td className="p-4 text-neutral-300 normal-case">{lead.email || '-'}</td>
                      <td className="p-4 font-mono text-xs">
                        <div className="flex items-center gap-2">{lead.phone}<button onClick={() => { navigator.clipboard.writeText(lead.phone); setNotification({ message: 'COPIED', type: 'success' }); setTimeout(() => setNotification(null), 1000); }}><Copy className="w-3 h-3 text-neutral-600 hover:text-white" /></button></div>
                      </td>
                      <td className="p-4 text-center text-xs font-bold text-neutral-500">{lead.assignedTo?.name || '-'}</td>
                      <td className="p-4 text-center text-xs font-bold text-amber-500/70">{lead.assignedAdvisor?.name || '-'}</td>
                      <td className="p-4">
                        <span className={`px-2 py-0.5 rounded text-[10px] font-black uppercase border ${lead.disposition === 'New' ? 'bg-blue-500/10 text-blue-400 border-blue-500/20' : 'bg-neutral-500/10 text-neutral-500 border-neutral-500/20'}`}>{lead.disposition}</span>
                      </td>
                      <td className="p-4 text-center"><button onClick={() => setExpandedId(expandedId === lead.id ? null : lead.id)}><MessageSquare className="w-4 h-4 text-neutral-600 hover:text-blue-400" /></button></td>
                      <td className="p-4 text-center"><input type="checkbox" checked={lead.verifiedSale} onChange={(e) => updateLead(lead.id, { verifiedSale: e.target.checked }, true)} className="rounded bg-neutral-800 text-blue-500" /></td>
                      <td className="p-4 text-center"><input type="checkbox" checked={lead.paymentReceived} onChange={(e) => updateLead(lead.id, { paymentReceived: e.target.checked }, true)} className="rounded bg-neutral-800 text-purple-500" /></td>
                    </motion.tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
          {totalPages > 1 && (
            <div className="bg-neutral-900/80 border-t border-neutral-800 p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div className="text-[10px] text-neutral-500 font-bold uppercase">
                Showing {pageStart}–{pageEnd} of {totalLeads.toLocaleString()} · Page {currentPage} of {totalPages}
              </div>
              <div className="flex gap-2">
                <button disabled={currentPage === 1 || pageLoading} onClick={() => setCurrentPage(prev => prev - 1)} className="px-4 py-1.5 bg-neutral-800 hover:bg-neutral-700 disabled:opacity-30 rounded text-[10px] font-black border border-neutral-700">PREV</button>
                <button disabled={currentPage === totalPages || pageLoading} onClick={() => setCurrentPage(prev => prev + 1)} className="px-4 py-1.5 bg-neutral-800 hover:bg-neutral-700 disabled:opacity-30 rounded text-[10px] font-black border border-neutral-700">NEXT</button>
              </div>
            </div>
          )}
          {totalPages <= 1 && totalLeads > 0 && (
            <div className="bg-neutral-900/80 border-t border-neutral-800 p-4 text-[10px] text-neutral-500 font-bold uppercase">
              {totalLeads.toLocaleString()} lead{totalLeads === 1 ? '' : 's'} total
            </div>
          )}
        </div>

        <AnimatePresence>
        {expandedId && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
            <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.95 }} className="w-full max-w-2xl bg-neutral-900 border border-neutral-800 rounded-3xl shadow-2xl p-8">
              <div className="flex justify-between items-center mb-6">
                <h3 className="text-xl font-black text-white uppercase tracking-tight flex items-center gap-3"><MessageSquare className="w-6 h-6 text-blue-500" /> LEAD DETAILS</h3>
                <button onClick={() => setExpandedId(null)} className="w-10 h-10 flex items-center justify-center rounded-full bg-neutral-800 hover:bg-red-500 text-white transition-all font-bold">×</button>
              </div>
              <div className="grid md:grid-cols-2 gap-8">
                <div className="space-y-4">
                  <p className="text-[10px] text-neutral-500 uppercase font-black tracking-widest">INTERNAL REMARKS</p>
                  <textarea value={leads.find(l => l.id === expandedId)?.remarks || ''} onChange={(e) => updateLead(expandedId, { remarks: e.target.value })} placeholder="ADD NOTES..." className="w-full bg-neutral-950 p-5 rounded-2xl border border-neutral-800 text-neutral-300 text-sm min-h-[150px] focus:ring-2 focus:ring-blue-500/20 outline-none resize-none transition-all" />
                  <button onClick={() => forceSave(expandedId!)} className="w-full bg-blue-600 hover:bg-blue-700 text-white py-3 rounded-xl text-xs font-black uppercase tracking-widest transition-all">FORCE SAVE</button>
                </div>
                <div className="space-y-6">
                  <div><p className="text-[10px] text-neutral-500 uppercase font-black mb-1">ASSIGNED AGENT</p><p className="text-white font-bold">{leads.find(l => l.id === expandedId)?.assignedTo?.name || 'NONE'}</p></div>
                  <div>
                    <p className="text-[10px] text-neutral-500 uppercase font-black mb-1">EMAIL</p>
                    <p className="text-white text-sm normal-case">{leads.find(l => l.id === expandedId)?.email || '-'}</p>
                  </div>
                  <div>
                    <p className="text-[10px] text-neutral-500 uppercase font-black mb-1">ADDRESS</p>
                    <p className="text-white text-sm leading-relaxed normal-case">
                      {[
                        leads.find(l => l.id === expandedId)?.addressLine1,
                        leads.find(l => l.id === expandedId)?.addressLine2,
                        leads.find(l => l.id === expandedId)?.addressLine3,
                        leads.find(l => l.id === expandedId)?.addressLine4,
                      ].filter(Boolean).join(', ') || leads.find(l => l.id === expandedId)?.address || '-'}
                      <br />
                      {leads.find(l => l.id === expandedId)?.postCode || ''}
                    </p>
                  </div>
                </div>
              </div>
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
