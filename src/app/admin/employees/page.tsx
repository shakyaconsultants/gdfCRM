'use client'

import { useState, useEffect } from 'react'
import Navigation from '@/components/Navigation'
import { Plus, Users, UserPlus, Loader2, Copy, Check, Trash2, Save, Camera } from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'
import { format } from 'date-fns'

type Employee = {
  id: string
  employeeId?: string
  name: string
  email: string
  profileImageUrl?: string | null
  baseSalaryMonthly?: number | null
  createdAt: string
}

export default function AdminEmployeesPage() {
  const [employees, setEmployees] = useState<Employee[]>([])
  const [loading, setLoading] = useState(true)
  
  // Create Form State
  const [showForm, setShowForm] = useState(false)
  const [formName, setFormName] = useState('')
  const [formEmail, setFormEmail] = useState('')
  const [formPassword, setFormPassword] = useState('')
  const [formInhandSalary, setFormInhandSalary] = useState('')
  const [formPhotoUrl, setFormPhotoUrl] = useState('')
  const [photoUploading, setPhotoUploading] = useState(false)
  const [formLoading, setFormLoading] = useState(false)
  const [error, setError] = useState('')
  const [copiedId, setCopiedId] = useState<string | null>(null)

  const fetchEmployees = async () => {
    try {
      const res = await fetch('/api/admin/employees')
      const data = await res.json()
      if (data.employees) setEmployees(data.employees)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchEmployees()
  }, [])

  const [successData, setSuccessData] = useState<{ name: string, email: string, pass: string } | null>(null)

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault()
    setFormLoading(true)
    setError('')
    setSuccessData(null)

    try {
      const res = await fetch('/api/admin/employees', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: formName,
          email: formEmail,
          password: formPassword,
          baseSalaryMonthly: formInhandSalary.trim() ? Number(formInhandSalary) : null,
          profileImageUrl: formPhotoUrl || null,
        })
      })
      const data = await res.json()

      if (res.ok && data.success) {
        setSuccessData({ name: formName, email: formEmail, pass: formPassword })
        setFormName('')
        setFormEmail('')
        setFormPassword('')
        setFormInhandSalary('')
        setFormPhotoUrl('')
        // Don't close form immediately so they can see success msg
        fetchEmployees()
      } else {
        setError(data.error || 'Failed to create employee')
      }
    } catch (err) {
      setError('An unexpected error occurred')
    } finally {
      setFormLoading(false)
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
      const res = await fetch('/api/admin/employees', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id })
      })
      if (res.ok) {
        fetchEmployees()
      } else {
        const data = await res.json()
        alert(data.error || 'Failed to delete employee')
      }
    } catch (e) {
      alert('Error deleting employee')
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

  const handlePhotoUpload = async (file: File) => {
    setPhotoUploading(true)
    setError('')
    try {
      const fd = new FormData()
      fd.append('file', file)
      const res = await fetch('/api/admin/employees/upload-photo', { method: 'POST', body: fd })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(data.error || 'Failed to upload photo')
        return
      }
      setFormPhotoUrl(data.profileImageUrl || '')
    } finally {
      setPhotoUploading(false)
    }
  }

  return (
    <div className="min-h-screen bg-neutral-950 text-neutral-200">
      <Navigation />
      
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between mb-8 gap-4">
          <div>
            <h1 className="text-2xl font-bold text-white flex items-center gap-2">
              <Users className="w-6 h-6 text-blue-500" />
              Manage Personnel
            </h1>
            <p className="text-neutral-400 text-sm mt-1">Generate profiles for your employees and manage access.</p>
          </div>
          
          <button 
            onClick={() => setShowForm(!showForm)}
            className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors flex items-center justify-center gap-2"
          >
            {showForm ? 'Cancel' : <><UserPlus className="w-4 h-4" /> Create Profile</>}
          </button>
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
                <h2 className="text-lg font-semibold text-white mb-4 border-b border-neutral-800 pb-2">New Employee Profile</h2>
                
                <form onSubmit={handleCreate} className="space-y-4">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-neutral-400 mb-1">Full Name</label>
                      <input 
                        type="text" 
                        required
                        value={formName}
                        onChange={e => setFormName(e.target.value)}
                        className="w-full bg-neutral-950 border border-neutral-800 rounded-lg py-2 px-3 focus:outline-none focus:ring-2 focus:ring-blue-500/50"
                        placeholder="John Doe"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-neutral-400 mb-1">Email Address</label>
                      <input 
                        type="email" 
                        required
                        value={formEmail}
                        onChange={e => setFormEmail(e.target.value)}
                        className="w-full bg-neutral-950 border border-neutral-800 rounded-lg py-2 px-3 focus:outline-none focus:ring-2 focus:ring-blue-500/50"
                        placeholder="john@company.com"
                      />
                    </div>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-neutral-400 mb-1">In-hand Salary (Monthly)</label>
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        value={formInhandSalary}
                        onChange={e => setFormInhandSalary(e.target.value)}
                        className="w-full bg-neutral-950 border border-neutral-800 rounded-lg py-2 px-3 focus:outline-none focus:ring-2 focus:ring-blue-500/50"
                        placeholder="e.g. 35000"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-neutral-400 mb-1">Profile Photo (optional)</label>
                      <div className="flex items-center gap-3">
                        <label className="inline-flex items-center gap-2 cursor-pointer bg-neutral-800 hover:bg-neutral-700 text-neutral-200 px-3 py-2 rounded-lg border border-neutral-700 text-sm">
                          {photoUploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Camera className="w-4 h-4" />}
                          Upload
                          <input
                            type="file"
                            accept="image/jpeg,image/png,image/gif,image/webp"
                            className="hidden"
                            onChange={e => {
                              const file = e.target.files?.[0]
                              e.currentTarget.value = ''
                              if (file) void handlePhotoUpload(file)
                            }}
                          />
                        </label>
                        {formPhotoUrl ? (
                          <img src={formPhotoUrl} alt="" className="w-10 h-10 rounded-full object-cover border border-neutral-700" />
                        ) : (
                          <div className="w-10 h-10 rounded-full bg-neutral-800 border border-neutral-700" />
                        )}
                      </div>
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
                        className="flex-1 bg-neutral-950 border border-neutral-800 rounded-lg py-2 px-3 focus:outline-none focus:ring-2 focus:ring-blue-500/50 font-mono text-white"
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
                        <p className="font-bold text-emerald-400">Profile Created Successfully!</p>
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

                  <div className="pt-2">
                    <button 
                      type="submit" 
                      disabled={formLoading}
                      className="bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white px-6 py-2 rounded-lg text-sm font-medium transition-colors flex items-center justify-center gap-2"
                    >
                      {formLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
                      Create Account
                    </button>
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
                  <th className="p-4 font-medium">Photo</th>
                  <th className="p-4 font-medium">Employee Name</th>
                  <th className="p-4 font-medium">Email Address</th>
                  <th className="p-4 font-medium">In-hand Salary</th>
                  <th className="p-4 font-medium">System ID</th>
                  <th className="p-4 font-medium">Date Created</th>
                  <th className="p-4 font-medium text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-800/50">
                {loading ? (
                   Array.from({ length: 3 }).map((_, i) => (
                    <tr key={i} className="animate-pulse">
                      <td className="p-4"><div className="h-8 w-8 bg-neutral-800 rounded-full"></div></td>
                      <td className="p-4"><div className="h-4 bg-neutral-800 rounded w-32"></div></td>
                      <td className="p-4"><div className="h-4 bg-neutral-800 rounded w-48"></div></td>
                      <td className="p-4"><div className="h-4 bg-neutral-800 rounded w-24"></div></td>
                      <td className="p-4"><div className="h-4 bg-neutral-800 rounded w-24"></div></td>
                      <td className="p-4"><div className="h-4 bg-neutral-800 rounded w-24"></div></td>
                      <td className="p-4"><div className="h-4 bg-neutral-800 rounded w-10 ml-auto"></div></td>
                    </tr>
                  ))
                ) : employees.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="p-8 text-center text-neutral-500">
                      No employees generated yet.
                    </td>
                  </tr>
                ) : (
                  employees.map((emp) => (
                    <motion.tr 
                      key={emp.id}
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      className="hover:bg-neutral-800/30 transition-colors group"
                    >
                      <td className="p-4">
                        <div className="w-8 h-8 rounded-full overflow-hidden bg-neutral-800 border border-neutral-700 flex items-center justify-center">
                          {emp.profileImageUrl ? (
                            <img src={emp.profileImageUrl} alt="" className="w-full h-full object-cover" />
                          ) : (
                            <Users className="w-4 h-4 text-neutral-500" />
                          )}
                        </div>
                      </td>
                      <td className="p-4 font-medium text-white">{emp.name}</td>
                      <td className="p-4 text-blue-400">{emp.email}</td>
                      <td className="p-4 text-sm text-neutral-300">
                        {emp.baseSalaryMonthly != null ? `₹${emp.baseSalaryMonthly.toLocaleString()}` : '—'}
                      </td>
                      <td className="p-4">
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-mono text-neutral-500 bg-neutral-950 border border-neutral-800 px-2 py-1 rounded">
                            {emp.employeeId || 'Legacy'}
                          </span>
                          {emp.employeeId && (
                            <button 
                              onClick={() => copyToClipboard(emp.employeeId!, emp.employeeId!)}
                              className="text-neutral-500 hover:text-white transition-colors"
                              title="Copy System ID"
                            >
                              {copiedId === emp.employeeId ? <Check className="w-4 h-4 text-emerald-500" /> : <Copy className="w-4 h-4" />}
                            </button>
                          )}
                        </div>
                      </td>
                      <td className="p-4 text-sm text-neutral-400">
                        {emp.createdAt ? format(new Date(emp.createdAt), 'MMM d, yyyy') : 'N/A'}
                      </td>
                      <td className="p-4 text-right">
                         <button 
                          onClick={() => handleDelete(emp.id, emp.name)}
                          className="p-2 text-neutral-500 hover:text-red-500 hover:bg-red-500/10 rounded-lg transition-all"
                          title="Delete Employee"
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
