'use client'

import { useState, useEffect, useCallback } from 'react'
import Navigation from '@/components/Navigation'
import AdminDateRangeFilter from '@/components/AdminDateRangeFilter'
import { Plus, Users, UserPlus, Loader2, Copy, Check, Trash2, Save, ArrowUpRight, Briefcase, ArrowRightLeft, UserX, UserCheck, CheckCircle2, ShieldAlert, BarChart3 } from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'
import { format, subDays } from 'date-fns'

type User = {
  id: string
  employeeId?: string
  name: string
  email: string
  createdAt: string
}

type AdvisorDashboard = {
  advisorCount: number
  totalTransferredFromEmployee: number
  totalForwardedToCaseAssessor: number
  totalDropped: number
  totalVerified: number
  totalClawback: number
  perAdvisor: {
    id: string
    name: string
    email: string
    transferredFromEmployee: number
    forwardedToCaseAssessor: number
    verified: number
    dropped: number
    clawback: number
  }[]
  range?: { from: string; to: string } | null
}

export default function AdminAdvisorsPage() {
  const [advisors, setAdvisors] = useState<User[]>([])
  const [employees, setEmployees] = useState<User[]>([])
  const [loading, setLoading] = useState(true)
  
  // Create / Promote Form State
  const [showForm, setShowForm] = useState(false)
  const [selectedEmployeeToPromote, setSelectedEmployeeToPromote] = useState('')
  const [formName, setFormName] = useState('')
  const [formEmail, setFormEmail] = useState('')
  const [formPassword, setFormPassword] = useState('')
  const [formLoading, setFormLoading] = useState(false)
  const [promoteLoading, setPromoteLoading] = useState(false)
  const [error, setError] = useState('')
  const [copiedId, setCopiedId] = useState<string | null>(null)
  const [dash, setDash] = useState<AdvisorDashboard | null>(null)
  const [dashLoading, setDashLoading] = useState(true)
  const [dateFrom, setDateFrom] = useState(() => format(subDays(new Date(), 30), 'yyyy-MM-dd'))
  const [dateTo, setDateTo] = useState(() => format(new Date(), 'yyyy-MM-dd'))

  const fetchData = async () => {
    try {
      const [advRes, empRes] = await Promise.all([
        fetch('/api/admin/advisors'),
        fetch('/api/admin/employees'),
      ])
      const advData = await advRes.json()
      const empData = await empRes.json()
      if (advData.advisors) setAdvisors(advData.advisors)
      if (empData.employees) setEmployees(empData.employees)
    } finally {
      setLoading(false)
    }
  }

  const fetchDashboard = useCallback(async () => {
    setDashLoading(true)
    try {
      const qs = dateFrom && dateTo ? `?from=${dateFrom}&to=${dateTo}` : ''
      const dashRes = await fetch(`/api/admin/advisors/dashboard${qs}`)
      const dashData = await dashRes.json()
      if (dashRes.ok && typeof dashData?.advisorCount === 'number') setDash(dashData)
      else setDash(null)
    } finally {
      setDashLoading(false)
    }
  }, [dateFrom, dateTo])

  useEffect(() => {
    fetchData()
  }, [])

  useEffect(() => {
    fetchDashboard()
  }, [fetchDashboard])

  const [successData, setSuccessData] = useState<{ name: string, email: string, pass: string } | null>(null)

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault()
    setFormLoading(true)
    setError('')
    setSuccessData(null)

    try {
      const res = await fetch('/api/admin/advisors', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: formName, email: formEmail, password: formPassword })
      })
      const data = await res.json()

      if (res.ok && data.success) {
        setSuccessData({ name: formName, email: formEmail, pass: formPassword })
        setFormName('')
        setFormEmail('')
        setFormPassword('')
        fetchData()
        fetchDashboard()
      } else {
        setError(data.error || 'Failed to create advisor')
      }
    } catch (err) {
      setError('An unexpected error occurred')
    } finally {
      setFormLoading(false)
    }
  }

  const handlePromote = async () => {
    if (!selectedEmployeeToPromote) return
    setPromoteLoading(true)
    setError('')

    try {
      const res = await fetch('/api/admin/advisors', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ employeeIdToPromote: selectedEmployeeToPromote })
      })
      const data = await res.json()

      if (res.ok && data.success) {
        setSelectedEmployeeToPromote('')
        fetchData()
        fetchDashboard()
      } else {
        setError(data.error || 'Failed to promote employee')
      }
    } catch (err) {
      setError('An unexpected error occurred')
    } finally {
      setPromoteLoading(false)
    }
  }

  const copyToClipboard = (text: string, id: string) => {
    navigator.clipboard.writeText(text)
    setCopiedId(id)
    setTimeout(() => setCopiedId(null), 2000)
  }

  const handleDelete = async (id: string, name: string) => {
    if (!confirm(`Are you sure you want to delete the profile for ${name}? This will unassign any active leads from them and permanently remove their access.`)) return

    try {
      const res = await fetch('/api/admin/advisors', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id })
      })
      if (res.ok) {
        fetchData()
        fetchDashboard()
      } else {
        const data = await res.json()
        alert(data.error || 'Failed to delete advisor')
      }
    } catch (e) {
      alert('Error deleting advisor')
    }
  }

  const generatePassword = () => {
    const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$'
    let pass = ''
    for (let i = 0; i < 12; i++) {
      pass += chars.charAt(Math.floor(Math.random() * chars.length))
    }
    setFormPassword(pass)
  }

  return (
    <div className="min-h-screen bg-neutral-950 text-neutral-200">
      <Navigation />
      
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between mb-8 gap-4">
          <div>
            <h1 className="text-2xl font-bold text-white flex items-center gap-2">
              <Users className="w-6 h-6 text-amber-500" />
              Manage Advisors
            </h1>
            <p className="text-neutral-400 text-sm mt-1">
              Advisor operations dashboard, workload, and team directory in one place.
            </p>
          </div>
          
          <button 
            onClick={() => setShowForm(!showForm)}
            className="bg-amber-600 hover:bg-amber-700 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors flex items-center justify-center gap-2"
          >
            {showForm ? 'Cancel' : <><UserPlus className="w-4 h-4" /> Add Advisor</>}
          </button>
        </div>

        {/* Advisor dashboard (admin view) */}
        <div className="mb-10">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-4">
            <div className="flex flex-wrap items-center gap-2">
              <BarChart3 className="w-5 h-5 text-amber-500" />
              <h2 className="text-lg font-bold text-white">Advisor dashboard</h2>
              <span className="text-xs text-neutral-500 uppercase tracking-widest">Lead stats by last update</span>
            </div>
            {dash?.range && (
              <p className="text-xs text-amber-500/90 font-mono">
                {dash.range.from} → {dash.range.to}
              </p>
            )}
            {!dash?.range && dash && (
              <p className="text-xs text-neutral-500">All-time lead stats</p>
            )}
          </div>

          <div className="mb-4">
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

          {dashLoading && !dash ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="h-28 bg-neutral-900 border border-neutral-800 rounded-2xl animate-pulse" />
              ))}
            </div>
          ) : dash ? (
            <>
              <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-5 gap-4 mb-6">
                {[
                  {
                    label: 'Transferred from employee',
                    value: dash.totalTransferredFromEmployee,
                    icon: ArrowRightLeft,
                    color: 'text-cyan-400',
                    bg: 'bg-cyan-500/10',
                    sub: 'Cases moved from employee CRM',
                  },
                  {
                    label: 'Dropped',
                    value: dash.totalDropped,
                    icon: UserX,
                    color: 'text-amber-400',
                    bg: 'bg-amber-500/10',
                    sub: 'Marked drop / closed',
                  },
                  {
                    label: 'Forwarded to case assessor',
                    value: dash.totalForwardedToCaseAssessor,
                    icon: UserCheck,
                    color: 'text-indigo-400',
                    bg: 'bg-indigo-500/10',
                    sub: 'Assigned case assessor',
                  },
                  {
                    label: 'Verified',
                    value: dash.totalVerified,
                    icon: CheckCircle2,
                    color: 'text-emerald-400',
                    bg: 'bg-emerald-500/10',
                    sub: 'Verified outcomes',
                  },
                  {
                    label: 'Clawback',
                    value: dash.totalClawback,
                    icon: ShieldAlert,
                    color: 'text-rose-400',
                    bg: 'bg-rose-500/10',
                    sub: 'Case status clawback',
                  },
                ].map((stat) => {
                  const Icon = stat.icon
                  return (
                    <motion.div
                      key={stat.label}
                      initial={{ opacity: 0, y: 8 }}
                      animate={{ opacity: 1, y: 0 }}
                      className="bg-neutral-900 border border-neutral-800 rounded-2xl p-5 hover:border-neutral-700 transition-colors"
                    >
                      <div className={`w-10 h-10 rounded-lg flex items-center justify-center mb-3 ${stat.bg}`}>
                        <Icon className={`w-5 h-5 ${stat.color}`} />
                      </div>
                      <p className="text-3xl font-bold text-white tabular-nums">{stat.value}</p>
                      <p className="text-xs font-medium text-neutral-500 uppercase tracking-wide mt-1">{stat.label}</p>
                      <p className="text-[10px] text-neutral-600 mt-1">{stat.sub}</p>
                    </motion.div>
                  )
                })}
              </div>

              <div className="bg-neutral-900/50 border border-neutral-800 rounded-2xl overflow-hidden">
                <div className="px-4 py-3 border-b border-neutral-800 bg-neutral-900/80">
                  <h3 className="text-sm font-bold text-white">Workload by advisor</h3>
                  <p className="text-xs text-neutral-500 mt-0.5">
                    Consistent flow tracking from employee transfer to final outcomes.
                  </p>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-sm">
                    <thead>
                      <tr className="border-b border-neutral-800 text-[10px] uppercase tracking-wider text-neutral-500">
                        <th className="p-3 pl-4">Advisor</th>
                        <th className="p-3 text-center">Transferred from employee</th>
                        <th className="p-3 text-center">Forwarded to case assessor</th>
                        <th className="p-3 text-center">Verified</th>
                        <th className="p-3 text-center">Dropped</th>
                        <th className="p-3 text-center pr-4">Clawback</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-neutral-800/50">
                      {dash.perAdvisor.length === 0 ? (
                        <tr>
                          <td colSpan={6} className="p-6 text-center text-neutral-500 text-sm">
                            No advisors yet. Add an advisor to see workload.
                          </td>
                        </tr>
                      ) : (
                        dash.perAdvisor.map((row) => (
                          <tr key={row.id} className="hover:bg-neutral-800/20">
                            <td className="p-3 pl-4">
                              <p className="font-semibold text-white">{row.name}</p>
                              <p className="text-xs text-neutral-500">{row.email}</p>
                            </td>
                            <td className="p-3 text-center font-mono text-cyan-400/90">{row.transferredFromEmployee}</td>
                            <td className="p-3 text-center font-mono text-indigo-400">{row.forwardedToCaseAssessor}</td>
                            <td className="p-3 text-center font-mono text-emerald-400">{row.verified}</td>
                            <td className="p-3 text-center font-mono text-amber-400">{row.dropped}</td>
                            <td className="p-3 text-center font-mono text-rose-400 pr-4">{row.clawback}</td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          ) : null}
        </div>

        <div className="flex items-center gap-2 mb-4">
          <Users className="w-5 h-5 text-neutral-400" />
          <h2 className="text-lg font-bold text-white">Directory &amp; accounts</h2>
        </div>

        <AnimatePresence>
          {showForm && (
            <motion.div 
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              className="overflow-hidden"
            >
              <div className="bg-neutral-900 border border-neutral-800 rounded-2xl p-6 mb-8 shadow-xl max-w-2xl">
                <div className="flex justify-between items-center mb-4 border-b border-neutral-800 pb-2">
                   <h2 className="text-lg font-semibold text-white">Create New Advisor</h2>
                </div>
                
                <form onSubmit={handleCreate} className="space-y-4">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-neutral-400 mb-1">Full Name</label>
                      <input 
                        type="text" 
                        required
                        value={formName}
                        onChange={e => setFormName(e.target.value)}
                        className="w-full bg-neutral-950 border border-neutral-800 rounded-lg py-2 px-3 focus:outline-none focus:ring-2 focus:ring-amber-500/50"
                        placeholder="Sarah Connor"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-neutral-400 mb-1">Email Address</label>
                      <input 
                        type="email" 
                        required
                        value={formEmail}
                        onChange={e => setFormEmail(e.target.value)}
                        className="w-full bg-neutral-950 border border-neutral-800 rounded-lg py-2 px-3 focus:outline-none focus:ring-2 focus:ring-amber-500/50"
                        placeholder="sarah@company.com"
                      />
                    </div>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-neutral-400 mb-1">Initial Password</label>
                    <div className="flex gap-2">
                       <input 
                        type="text" 
                        required
                        value={formPassword}
                        onChange={e => setFormPassword(e.target.value)}
                        className="flex-1 bg-neutral-950 border border-neutral-800 rounded-lg py-2 px-3 focus:outline-none focus:ring-2 focus:ring-amber-500/50 font-mono text-white"
                        placeholder="••••••••"
                      />
                      <button 
                        type="button" 
                        onClick={generatePassword}
                        className="bg-neutral-800 hover:bg-neutral-700 text-neutral-300 px-4 py-2 rounded-lg text-sm transition-colors border border-neutral-700"
                      >
                        Auto-Generate
                      </button>
                    </div>
                    <p className="text-xs text-neutral-500 mt-1">They will use this password to log in. Please copy it safely.</p>
                  </div>

                  {successData && (
                    <motion.div 
                      initial={{ opacity: 0, y: -10 }}
                      animate={{ opacity: 1, y: 0 }}
                      className="bg-emerald-500/10 border border-emerald-500/20 p-4 rounded-xl text-sm"
                    >
                      <div className="flex justify-between items-start mb-2">
                        <p className="font-bold text-emerald-400">Advisor Created Successfully!</p>
                        <button onClick={() => setSuccessData(null)} className="text-neutral-500 hover:text-white text-xs">Clear</button>
                      </div>
                      <div className="space-y-1 font-mono text-xs">
                        <p><span className="text-neutral-500">Name:</span> <span className="text-white">{successData.name}</span></p>
                        <p><span className="text-neutral-500">Email:</span> <span className="text-white">{successData.email}</span></p>
                        <p><span className="text-neutral-500">Pass:</span> <span className="text-emerald-400 font-bold">{successData.pass}</span></p>
                      </div>
                      <p className="text-[10px] text-amber-500 mt-3 flex items-center gap-1">
                        <Save className="w-3 h-3" /> Copy these details now. They won&apos;t be shown again.
                      </p>
                    </motion.div>
                  )}

                  {error && (
                    <div className="text-red-400 text-sm bg-red-400/10 border border-red-400/20 p-3 rounded-lg">
                      {error}
                    </div>
                  )}

                  <div className="pt-2 border-b border-neutral-800 pb-6 mb-4">
                    <button 
                      type="submit" 
                      disabled={formLoading}
                      className="bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white px-6 py-2 rounded-lg text-sm font-medium transition-colors flex items-center justify-center gap-2"
                    >
                      {formLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
                      Create Advisor
                    </button>
                  </div>

                  <div className="pt-2">
                     <h3 className="text-sm font-medium text-neutral-300 mb-3 flex items-center gap-2">
                        <ArrowUpRight className="w-4 h-4 text-amber-500" />
                        Or Promote Existing Employee
                     </h3>
                     <div className="flex gap-2">
                        <select 
                           value={selectedEmployeeToPromote}
                           onChange={e => setSelectedEmployeeToPromote(e.target.value)}
                           className="flex-1 bg-neutral-950 border border-neutral-800 rounded-lg py-2 px-3 focus:outline-none focus:ring-2 focus:ring-amber-500/50 text-sm text-neutral-200"
                        >
                           <option value="">Select an employee...</option>
                           {employees.map(e => (
                              <option key={e.id} value={e.id}>{e.name} ({e.email})</option>
                           ))}
                        </select>
                        <button 
                           type="button"
                           onClick={handlePromote}
                           disabled={!selectedEmployeeToPromote || promoteLoading}
                           className="bg-amber-600 hover:bg-amber-700 disabled:opacity-50 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors flex items-center gap-2"
                        >
                           {promoteLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Promote'}
                        </button>
                     </div>
                  </div>
                </form>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        <div className="bg-neutral-900/50 border border-neutral-800 rounded-2xl overflow-hidden backdrop-blur-sm shadow-xl">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-neutral-800 bg-neutral-900/80 text-xs uppercase tracking-wider text-neutral-400">
                  <th className="p-4 font-medium">Advisor Name</th>
                  <th className="p-4 font-medium">Email Address</th>
                  <th className="p-4 font-medium">System ID</th>
                  <th className="p-4 font-medium">Date Promoted/Created</th>
                  <th className="p-4 font-medium text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-800/50">
                {loading ? (
                   Array.from({ length: 3 }).map((_, i) => (
                    <tr key={i} className="animate-pulse">
                      <td className="p-4"><div className="h-4 bg-neutral-800 rounded w-32"></div></td>
                      <td className="p-4"><div className="h-4 bg-neutral-800 rounded w-48"></div></td>
                      <td className="p-4"><div className="h-4 bg-neutral-800 rounded w-24"></div></td>
                      <td className="p-4"><div className="h-4 bg-neutral-800 rounded w-24"></div></td>
                      <td className="p-4"><div className="h-4 bg-neutral-800 rounded w-10 ml-auto"></div></td>
                    </tr>
                  ))
                ) : advisors.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="p-8 text-center text-neutral-500">
                      No advisors have been added yet.
                    </td>
                  </tr>
                ) : (
                  advisors.map((adv) => (
                    <motion.tr 
                      key={adv.id}
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      className="hover:bg-neutral-800/30 transition-colors group"
                    >
                      <td className="p-4 font-bold text-white">{adv.name}</td>
                      <td className="p-4 text-blue-400">{adv.email}</td>
                      <td className="p-4">
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-mono text-amber-500 bg-neutral-950 border border-neutral-800 px-2 py-1 rounded">
                            {adv.employeeId || 'Legacy'}
                          </span>
                          {adv.employeeId && (
                            <button 
                              onClick={() => copyToClipboard(adv.employeeId!, adv.employeeId!)}
                              className="text-neutral-500 hover:text-white transition-colors"
                              title="Copy System ID"
                            >
                              {copiedId === adv.employeeId ? <Check className="w-4 h-4 text-emerald-500" /> : <Copy className="w-4 h-4" />}
                            </button>
                          )}
                        </div>
                      </td>
                      <td className="p-4 text-sm text-neutral-400">
                        {adv.createdAt ? format(new Date(adv.createdAt), 'MMM d, yyyy') : 'N/A'}
                      </td>
                      <td className="p-4 text-right">
                         <button 
                          onClick={() => handleDelete(adv.id, adv.name)}
                          className="p-2 text-neutral-500 hover:text-red-500 hover:bg-red-500/10 rounded-lg transition-all"
                          title="Delete Advisor"
                         >
                           <Trash2 className="w-4 h-4" />
                         </button>
                      </td>
                    </motion.tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </main>
    </div>
  )
}
