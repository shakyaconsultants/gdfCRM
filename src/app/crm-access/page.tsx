'use client'

import { useState } from 'react'
import Link from 'next/link'
import { Globe, ArrowLeft, Loader2, Mail, KeyRound, CheckCircle2 } from 'lucide-react'

type Step = 'email' | 'otp' | 'done'

export default function CrmAccessPage() {
  const [step, setStep] = useState<Step>('email')
  const [email, setEmail] = useState('')
  const [otp, setOtp] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [info, setInfo] = useState('')

  const sendOtp = async () => {
    setError('')
    setInfo('')
    if (!email.trim()) { setError('Enter your work email.'); return }
    setBusy(true)
    try {
      const res = await fetch('/api/auth/crm-access/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim().toLowerCase() }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) { setError(data.error || 'Could not send code.'); return }
      setInfo(data.message || 'Code sent to admin inbox.')
      setStep('otp')
    } finally {
      setBusy(false)
    }
  }

  const verifyOtp = async () => {
    setError('')
    const code = otp.replace(/\D/g, '')
    if (code.length !== 6) { setError('Enter the 6-digit code.'); return }
    setBusy(true)
    try {
      const res = await fetch('/api/auth/crm-access/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ otp: code }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) { setError(data.error || 'Invalid code.'); return }
      setStep('done')
      setTimeout(() => { window.location.href = '/employee/crm' }, 800)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div
      className="min-h-screen flex flex-col items-center justify-center px-4"
      style={{ backgroundColor: '#05080f' }}
    >
      {/* Back to site */}
      <div className="w-full max-w-md mb-6">
        <Link
          href="/"
          className="inline-flex items-center gap-1.5 text-sm transition-colors"
          style={{ color: 'rgba(245,194,107,0.6)' }}
          onMouseEnter={(e) => { e.currentTarget.style.color = '#F5C26B' }}
          onMouseLeave={(e) => { e.currentTarget.style.color = 'rgba(245,194,107,0.6)' }}
        >
          <ArrowLeft size={14} /> Back to site
        </Link>
      </div>

      <div
        className="w-full max-w-md rounded-2xl p-8"
        style={{ backgroundColor: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.1)' }}
      >
        {/* Logo */}
        <div className="flex items-center gap-2 mb-8">
          <Globe size={20} style={{ color: '#F5C26B' }} />
          <span className="font-bold" style={{ color: '#F5C26B' }}>GDF Internationals</span>
        </div>

        {step === 'email' && (
          <>
            <div className="flex items-center gap-3 mb-6">
              <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ backgroundColor: 'rgba(245,194,107,0.12)' }}>
                <Mail size={18} style={{ color: '#F5C26B' }} />
              </div>
              <div>
                <h1 className="text-lg font-bold text-white">CRM Access</h1>
                <p className="text-xs" style={{ color: 'rgba(255,255,255,0.45)' }}>No password needed — enter your work email</p>
              </div>
            </div>

            <div className="space-y-4">
              <div>
                <label className="block text-xs font-medium mb-1.5" style={{ color: 'rgba(255,255,255,0.55)' }}>
                  Work email
                </label>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && sendOtp()}
                  placeholder="you@company.com"
                  autoFocus
                  className="w-full rounded-xl px-4 py-3 text-sm text-white placeholder-neutral-600 focus:outline-none focus:ring-2"
                  style={{
                    backgroundColor: 'rgba(255,255,255,0.06)',
                    border: '1px solid rgba(255,255,255,0.12)',
                  }}
                />
              </div>

              {error && <p className="text-xs text-red-400">{error}</p>}

              <button
                onClick={sendOtp}
                disabled={busy}
                className="w-full flex items-center justify-center gap-2 py-3 rounded-xl font-semibold text-sm text-black transition-all disabled:opacity-60"
                style={{ backgroundColor: '#F5C26B' }}
                onMouseEnter={(e) => { if (!busy) e.currentTarget.style.backgroundColor = '#ffd47a' }}
                onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = '#F5C26B' }}
              >
                {busy ? <Loader2 size={16} className="animate-spin" /> : null}
                Send verification code
              </button>
            </div>
          </>
        )}

        {step === 'otp' && (
          <>
            <div className="flex items-center gap-3 mb-6">
              <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ backgroundColor: 'rgba(245,194,107,0.12)' }}>
                <KeyRound size={18} style={{ color: '#F5C26B' }} />
              </div>
              <div>
                <h1 className="text-lg font-bold text-white">Enter code</h1>
                <p className="text-xs" style={{ color: 'rgba(255,255,255,0.45)' }}>Code sent to admin inbox for <span style={{ color: '#F5C26B' }}>{email}</span></p>
              </div>
            </div>

            {info && <p className="text-xs mb-4 rounded-lg px-3 py-2" style={{ backgroundColor: 'rgba(245,194,107,0.08)', color: 'rgba(245,194,107,0.8)', border: '1px solid rgba(245,194,107,0.15)' }}>{info}</p>}

            <div className="space-y-4">
              <input
                type="text"
                inputMode="numeric"
                value={otp}
                onChange={(e) => setOtp(e.target.value.replace(/\D/g, '').slice(0, 6))}
                onKeyDown={(e) => e.key === 'Enter' && verifyOtp()}
                placeholder="••••••"
                autoFocus
                maxLength={6}
                className="w-full rounded-xl px-4 py-4 text-center text-2xl font-mono tracking-[0.5em] text-white focus:outline-none focus:ring-2"
                style={{
                  backgroundColor: 'rgba(255,255,255,0.06)',
                  border: '1px solid rgba(255,255,255,0.12)',
                }}
              />

              {error && <p className="text-xs text-red-400">{error}</p>}

              <button
                onClick={verifyOtp}
                disabled={busy || otp.replace(/\D/g, '').length !== 6}
                className="w-full flex items-center justify-center gap-2 py-3 rounded-xl font-semibold text-sm text-black transition-all disabled:opacity-60"
                style={{ backgroundColor: '#F5C26B' }}
                onMouseEnter={(e) => { if (!busy) e.currentTarget.style.backgroundColor = '#ffd47a' }}
                onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = '#F5C26B' }}
              >
                {busy ? <Loader2 size={16} className="animate-spin" /> : null}
                Access CRM
              </button>

              <button
                onClick={() => { setStep('email'); setOtp(''); setError('') }}
                className="w-full py-2 text-xs transition-colors"
                style={{ color: 'rgba(255,255,255,0.4)' }}
                onMouseEnter={(e) => { e.currentTarget.style.color = 'rgba(255,255,255,0.7)' }}
                onMouseLeave={(e) => { e.currentTarget.style.color = 'rgba(255,255,255,0.4)' }}
              >
                ← Use a different email
              </button>
            </div>
          </>
        )}

        {step === 'done' && (
          <div className="text-center py-4">
            <CheckCircle2 size={48} className="mx-auto mb-4" style={{ color: '#F5C26B' }} />
            <h2 className="text-lg font-bold text-white mb-2">Access granted</h2>
            <p className="text-sm" style={{ color: 'rgba(255,255,255,0.5)' }}>Redirecting to CRM…</p>
          </div>
        )}
      </div>

      <p className="mt-6 text-xs" style={{ color: 'rgba(255,255,255,0.25)' }}>
        Looking for your team workspace?{' '}
        <Link href="/login" className="underline" style={{ color: 'rgba(245,194,107,0.5)' }}>
          Team login
        </Link>
      </p>
    </div>
  )
}
