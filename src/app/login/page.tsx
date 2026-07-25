'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { motion, AnimatePresence } from 'framer-motion'
import Link from 'next/link'
import { Loader2, Mail, Lock, Shield, ArrowLeft } from 'lucide-react'

export default function LoginPage() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [otp, setOtp] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [step, setStep] = useState<'credentials' | 'otp'>('credentials')
  const [otpHint, setOtpHint] = useState('')
  const router = useRouter()

  const handleCancelOtp = async () => {
    await fetch('/api/auth/cancel-login', { method: 'POST' })
    setStep('credentials')
    setOtp('')
    setOtpHint('')
    setError('')
  }

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError('')

    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      })

      const data = await res.json()

      if (!res.ok) {
        setError(data.error || 'Failed to login')
        return
      }

      if (data.requireOtp) {
        setStep('otp')
        setOtpHint(data.message || '')
        setOtp('')
        return
      }

      if (data.redirect) {
        router.push(data.redirect)
      }
    } catch {
      setError('An unexpected error occurred.')
    } finally {
      setLoading(false)
    }
  }

  const handleVerifyOtp = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError('')

    try {
      const res = await fetch('/api/auth/verify-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ otp: otp.replace(/\s/g, '') }),
      })

      const data = await res.json()

      if (!res.ok) {
        setError(data.error || 'Verification failed')
        return
      }

      if (data.redirect) {
        router.push(data.redirect)
      }
    } catch {
      setError('An unexpected error occurred.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-neutral-950 flex items-center justify-center p-4 relative">
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-blue-900/20 via-neutral-950 to-neutral-950" aria-hidden />

      <Link
        href="/"
        className="absolute top-6 left-6 z-20 inline-flex items-center gap-1.5 text-sm text-neutral-400 hover:text-white transition-colors"
      >
        <ArrowLeft className="w-4 h-4" />
        Back to website
      </Link>

      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
        className="w-full max-w-md relative z-10"
      >
        <div className="bg-neutral-900/50 backdrop-blur-xl border border-neutral-800 rounded-2xl p-8 shadow-2xl">
          <div className="text-center mb-8">
            <img
              src="/logo.png"
              alt="Shakya Consultants"
              className="mx-auto h-16 w-auto max-w-[240px] object-contain mb-4"
            />
            <h1 className="sr-only">Shakya Consultants</h1>
            <p className="text-neutral-400 mt-2">
              {step === 'credentials'
                ? 'Team workspace — sign in with your email and password.'
                : 'Enter the 6-digit code sent to the administrator email.'}
            </p>
          </div>

          <AnimatePresence mode="wait">
            {step === 'credentials' ? (
              <motion.form
                key="creds"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                onSubmit={handleLogin}
                className="space-y-4"
              >
                <div>
                  <label className="block text-sm font-medium text-neutral-300 mb-1">Email</label>
                  <div className="relative">
                    <Mail className="w-5 h-5 absolute left-3 top-1/2 -translate-y-1/2 text-neutral-500" />
                    <input
                      type="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      className="w-full bg-neutral-950/50 border border-neutral-800 rounded-lg py-2.5 pl-10 pr-4 text-neutral-200 focus:outline-none focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500 transition-all"
                      placeholder="name@example.com"
                      required
                      autoComplete="email"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium text-neutral-300 mb-1">Password</label>
                  <div className="relative">
                    <Lock className="w-5 h-5 absolute left-3 top-1/2 -translate-y-1/2 text-neutral-500" />
                    <input
                      type="password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      className="w-full bg-neutral-950/50 border border-neutral-800 rounded-lg py-2.5 pl-10 pr-4 text-neutral-200 focus:outline-none focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500 transition-all"
                      placeholder="••••••••"
                      required
                      autoComplete="current-password"
                    />
                  </div>
                </div>

                {error && (
                  <div className="text-red-400 text-sm bg-red-400/10 border border-red-400/20 p-3 rounded-lg">{error}</div>
                )}

                <button
                  type="submit"
                  disabled={loading}
                  className="w-full bg-blue-600 hover:bg-blue-700 text-white font-medium py-2.5 rounded-lg transition-colors flex items-center justify-center mt-6 disabled:opacity-50"
                >
                  {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : 'Continue'}
                </button>
                <p className="text-center text-neutral-500 text-xs">
                  If your server has an admin email configured, you will be asked for a one-time code next.
                </p>
              </motion.form>
            ) : (
              <motion.form
                key="otp"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                onSubmit={handleVerifyOtp}
                className="space-y-4"
              >
                {otpHint && (
                  <div className="text-sm text-amber-500/90 bg-amber-500/10 border border-amber-500/20 p-3 rounded-lg">
                    {otpHint}
                  </div>
                )}
                <div>
                  <label className="block text-sm font-medium text-neutral-300 mb-1">Verification code</label>
                  <div className="relative">
                    <Shield className="w-5 h-5 absolute left-3 top-1/2 -translate-y-1/2 text-amber-500" />
                    <input
                      type="text"
                      inputMode="numeric"
                      pattern="[0-9]*"
                      maxLength={6}
                      value={otp}
                      onChange={(e) => setOtp(e.target.value.replace(/\D/g, '').slice(0, 6))}
                      className="w-full bg-neutral-950/50 border border-amber-500/30 rounded-lg py-2.5 pl-10 pr-4 text-lg tracking-[0.4em] text-center text-white font-mono focus:outline-none focus:ring-2 focus:ring-amber-500/50"
                      placeholder="000000"
                      required
                      autoComplete="one-time-code"
                    />
                  </div>
                  <p className="text-xs text-neutral-500 mt-2">
                    Ask the administrator for the code from their inbox, or check the server log in development.
                  </p>
                </div>

                {error && (
                  <div className="text-red-400 text-sm bg-red-400/10 border border-red-400/20 p-3 rounded-lg">{error}</div>
                )}

                <button
                  type="submit"
                  disabled={loading || otp.length !== 6}
                  className="w-full bg-amber-600 hover:bg-amber-700 text-white font-medium py-2.5 rounded-lg transition-colors flex items-center justify-center disabled:opacity-50"
                >
                  {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : 'Verify & sign in'}
                </button>

                <button
                  type="button"
                  onClick={handleCancelOtp}
                  className="w-full flex items-center justify-center gap-2 text-sm text-neutral-500 hover:text-white py-2"
                >
                  <ArrowLeft className="w-4 h-4" />
                  Back to email and password
                </button>
              </motion.form>
            )}
          </AnimatePresence>
        </div>
      </motion.div>
    </div>
  )
}
