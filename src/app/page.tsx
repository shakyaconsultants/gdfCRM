'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import Link from 'next/link'
import { Syne, DM_Sans } from 'next/font/google'
import { motion, useReducedMotion } from 'framer-motion'
import {
  PhoneCall,
  Users,
  CheckCircle,
  ChevronDown,
  Menu,
  X,
  ArrowRight,
  Target,
  Headphones,
  BarChart3,
  Shield,
  Mail,
  MapPin,
  Globe,
} from 'lucide-react'

const display = Syne({
  subsets: ['latin'],
  variable: '--font-sc-display',
  display: 'swap',
})

const sans = DM_Sans({
  subsets: ['latin'],
  variable: '--font-sc-sans',
  display: 'swap',
})

const NAV_LINKS = [
  { label: 'Services', href: '#services' },
  { label: 'Why Us', href: '#why-us' },
  { label: 'How It Works', href: '#how-it-works' },
  { label: 'Contact', href: '#contact' },
]

const SERVICES = [
  {
    icon: PhoneCall,
    title: 'Outbound Sales Calling',
    desc: 'Dedicated teams making high-volume outbound calls to your prospects, converting cold leads into warm opportunities.',
  },
  {
    icon: Target,
    title: 'Lead Generation',
    desc: 'We source, qualify, and deliver sales-ready leads so your closers can focus on what they do best.',
  },
  {
    icon: Headphones,
    title: 'Customer Follow-Up',
    desc: 'Structured callback systems and follow-up cadences to ensure no lead falls through the cracks.',
  },
  {
    icon: BarChart3,
    title: 'Sales Reporting',
    desc: 'Real-time dashboards and weekly reports giving you full visibility into pipeline, performance, and KPIs.',
  },
  {
    icon: Users,
    title: 'Dedicated Sales Teams',
    desc: 'Fully managed sales representatives working exclusively for your business under your brand.',
  },
  {
    icon: Shield,
    title: 'Compliance & Quality',
    desc: 'All calls conducted to FCA and ICO standards with full call recording and quality assurance processes.',
  },
]

const STATS = [
  { value: '500+', label: 'Leads Processed Monthly' },
  { value: '92%', label: 'Client Retention Rate' },
  { value: '3x', label: 'Average ROI for Clients' },
  { value: '5+', label: 'Years of Experience' },
]

const STEPS = [
  {
    num: '01',
    title: 'Onboarding & Discovery',
    desc: 'We learn your product, target market, and sales goals to build a tailored outreach strategy.',
  },
  {
    num: '02',
    title: 'Team Setup & Training',
    desc: 'Our sales representatives are trained on your script, objections, and CRM workflow before day one.',
  },
  {
    num: '03',
    title: 'Live & Reporting',
    desc: 'Campaigns go live with full tracking. You get weekly reporting and direct access to your account manager.',
  },
]

const WHY_POINTS = [
  'Dedicated reps trained on your product & script',
  'FCA & ICO compliant outreach processes',
  'Live CRM tracking with real-time reporting',
  'No long-term lock-in — results-driven contracts',
  'India-based team with global client delivery',
]

const METRICS = [
  { label: 'Avg. Calls Per Day', value: '200+', sub: 'Per representative' },
  { label: 'Lead Conversion', value: '18%', sub: 'Industry avg. 8%' },
  { label: 'Onboarding Time', value: '7 Days', sub: 'From sign-up to live' },
  { label: 'Quality Score', value: '96%', sub: 'QA monitored calls' },
]

function smoothScroll(href: string) {
  const el = document.querySelector(href)
  if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' })
}

const fadeUp = {
  hidden: { opacity: 0, y: 28 },
  visible: { opacity: 1, y: 0 },
}

export default function LandingPage() {
  const [mobileOpen, setMobileOpen] = useState(false)
  const [scrolled, setScrolled] = useState(false)
  const [activeSection, setActiveSection] = useState('')
  const menuRef = useRef<HTMLDivElement>(null)
  const reduceMotion = useReducedMotion()

  useEffect(() => {
    const onScroll = () => {
      setScrolled(window.scrollY > 20)
      const ids = NAV_LINKS.map((n) => n.href.replace('#', ''))
      const current = ids.find((id) => {
        const el = document.getElementById(id)
        if (!el) return false
        const rect = el.getBoundingClientRect()
        return rect.top <= 120 && rect.bottom >= 120
      })
      if (current) setActiveSection(`#${current}`)
    }
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  const closeMobile = useCallback(() => setMobileOpen(false), [])

  useEffect(() => {
    if (mobileOpen) document.body.style.overflow = 'hidden'
    else document.body.style.overflow = ''
    return () => {
      document.body.style.overflow = ''
    }
  }, [mobileOpen])

  const motionProps = reduceMotion
    ? {}
    : {
        initial: 'hidden' as const,
        whileInView: 'visible' as const,
        viewport: { once: true, margin: '-80px' },
        variants: fadeUp,
        transition: { duration: 0.55, ease: [0.22, 1, 0.36, 1] as const },
      }

  return (
    <div
      className={`${display.variable} ${sans.variable} sc-landing`}
      style={{
        fontFamily: 'var(--font-sc-sans), system-ui, sans-serif',
        backgroundColor: 'var(--sc-paper)',
        color: 'var(--sc-ink)',
      }}
    >
      <style>{`
        .sc-landing {
          --sc-ink: #0b1220;
          --sc-muted: #5a6578;
          --sc-brand: #1a4f8b;
          --sc-accent: #2f6fad;
          --sc-paper: #f5f7fb;
          --sc-fog: #e8edf5;
          --sc-line: rgba(11, 18, 32, 0.1);
          --sc-white: #ffffff;
        }

        .sc-landing a {
          text-decoration: none;
        }

        @keyframes sc-drift {
          0%,
          100% {
            transform: translate3d(0, 0, 0) scale(1);
          }
          50% {
            transform: translate3d(1.2%, -1.2%, 0) scale(1.03);
          }
        }

        @keyframes sc-rise {
          from {
            opacity: 0;
            transform: translateY(18px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }

        .sc-hero-media {
          animation: sc-drift 24s ease-in-out infinite;
        }

        .sc-hero-copy > * {
          animation: sc-rise 0.7s cubic-bezier(0.22, 1, 0.36, 1) both;
        }

        .sc-hero-copy > *:nth-child(1) {
          animation-delay: 0.05s;
        }
        .sc-hero-copy > *:nth-child(2) {
          animation-delay: 0.16s;
        }
        .sc-hero-copy > *:nth-child(3) {
          animation-delay: 0.28s;
        }
        .sc-hero-copy > *:nth-child(4) {
          animation-delay: 0.4s;
        }

        @media (prefers-reduced-motion: reduce) {
          .sc-hero-media,
          .sc-hero-copy > * {
            animation: none !important;
          }
        }
      `}</style>

      {/* ── NAVBAR ── */}
      <nav
        className="fixed top-0 left-0 right-0 z-50 transition-all duration-300"
        style={{
          height: '72px',
          backgroundColor: scrolled ? 'rgba(245, 247, 251, 0.92)' : 'transparent',
          backdropFilter: scrolled ? 'blur(14px)' : 'none',
          borderBottom: scrolled ? '1px solid var(--sc-line)' : '1px solid transparent',
        }}
      >
        <div className="max-w-6xl mx-auto px-5 lg:px-8 flex items-center justify-between h-full">
          <a
            href="#"
            onClick={(e) => {
              e.preventDefault()
              window.scrollTo({ top: 0, behavior: 'smooth' })
            }}
            className="flex items-center gap-3"
            aria-label="Shakya Consultants home"
          >
            <img
              src="/logo.png"
              alt="Shakya Consultants"
              className="h-10 w-auto max-w-[200px] object-contain"
            />
            <span
              className="hidden sm:block text-[10px] font-medium tracking-[0.14em] uppercase border-l pl-3"
              style={{
                color: scrolled || mobileOpen ? 'var(--sc-muted)' : 'rgba(255,255,255,0.65)',
                borderColor: scrolled || mobileOpen ? 'var(--sc-line)' : 'rgba(255,255,255,0.25)',
              }}
            >
              Sales Portal
            </span>
          </a>

          <div className="hidden md:flex items-center gap-8">
            {NAV_LINKS.map((item) => (
              <a
                key={item.href}
                href={item.href}
                onClick={(e) => {
                  e.preventDefault()
                  smoothScroll(item.href)
                }}
                className="text-sm font-medium transition-colors duration-200"
                style={{
                  color: scrolled
                    ? activeSection === item.href
                      ? 'var(--sc-brand)'
                      : 'var(--sc-muted)'
                    : activeSection === item.href
                      ? '#fff'
                      : 'rgba(255,255,255,0.72)',
                }}
              >
                {item.label}
              </a>
            ))}
          </div>

          <div className="hidden md:flex items-center gap-2">
            <Link
              href="/login"
              className="inline-flex items-center px-4 py-2 text-sm font-medium transition-colors duration-200"
              style={{ color: scrolled ? 'var(--sc-muted)' : 'rgba(255,255,255,0.78)' }}
            >
              Team Login
            </Link>
            <Link
              href="/crm-access"
              className="inline-flex items-center gap-1.5 px-4 py-2.5 text-sm font-semibold transition-opacity hover:opacity-90"
              style={{
                backgroundColor: scrolled ? 'var(--sc-brand)' : 'var(--sc-white)',
                color: scrolled ? 'var(--sc-white)' : 'var(--sc-brand)',
                borderRadius: '8px',
              }}
            >
              CRM Access <ArrowRight size={14} />
            </Link>
          </div>

          <button
            className="md:hidden p-2 rounded-md"
            style={{
              backgroundColor: scrolled ? 'var(--sc-fog)' : 'rgba(255,255,255,0.15)',
              color: scrolled ? 'var(--sc-brand)' : '#fff',
            }}
            onClick={() => setMobileOpen((v) => !v)}
            aria-label="Toggle menu"
          >
            {mobileOpen ? <X size={22} /> : <Menu size={22} />}
          </button>
        </div>
      </nav>

      {/* Mobile menu */}
      {mobileOpen && (
        <div
          ref={menuRef}
          className="fixed inset-0 z-40 flex flex-col pt-[72px]"
          style={{ backgroundColor: 'rgba(245, 247, 251, 0.98)', backdropFilter: 'blur(16px)' }}
        >
          <div className="flex flex-col gap-1 px-6 py-6">
            {NAV_LINKS.map((item) => (
              <a
                key={item.href}
                href={item.href}
                onClick={(e) => {
                  e.preventDefault()
                  smoothScroll(item.href)
                  closeMobile()
                }}
                className="py-4 text-lg font-medium border-b"
                style={{ color: 'var(--sc-ink)', borderColor: 'var(--sc-line)' }}
              >
                {item.label}
              </a>
            ))}
            <Link
              href="/crm-access"
              onClick={closeMobile}
              className="mt-6 flex items-center justify-center gap-2 py-4 font-semibold text-base"
              style={{
                backgroundColor: 'var(--sc-brand)',
                color: 'var(--sc-white)',
                borderRadius: '8px',
              }}
            >
              CRM Access <ArrowRight size={16} />
            </Link>
            <Link
              href="/login"
              onClick={closeMobile}
              className="flex items-center justify-center gap-2 py-4 font-semibold text-base mt-2"
              style={{
                border: '1px solid var(--sc-line)',
                color: 'var(--sc-brand)',
                borderRadius: '8px',
              }}
            >
              Team Login
            </Link>
          </div>
        </div>
      )}

      {/* ── HERO ── */}
      <section className="relative min-h-[100svh] flex items-end overflow-hidden">
        <div className="absolute inset-0 sc-hero-media">
          <div
            className="absolute inset-0 bg-cover bg-center"
            style={{
              backgroundImage:
                "url('https://images.unsplash.com/photo-1600880292203-757bb62b4baf?auto=format&fit=crop&w=2400&q=80')",
            }}
          />
          <div
            className="absolute inset-0"
            style={{
              background:
                'linear-gradient(180deg, rgba(11,18,32,0.45) 0%, rgba(11,18,32,0.62) 42%, rgba(11,18,32,0.92) 100%)',
            }}
          />
          <div
            className="absolute inset-0 opacity-50"
            style={{
              background:
                'radial-gradient(ellipse 65% 55% at 75% 15%, rgba(47,111,173,0.35), transparent 60%)',
            }}
          />
        </div>

        <div className="relative z-10 w-full max-w-6xl mx-auto px-5 lg:px-8 pb-16 pt-28 md:pb-24 md:pt-36">
          <div className="sc-hero-copy max-w-2xl">
            <img
              src="/logo.png"
              alt="Shakya Consultants"
              className="h-16 sm:h-20 md:h-24 w-auto max-w-[min(100%,360px)] object-contain mb-6"
            />
            <h1
              className="text-2xl sm:text-3xl md:text-4xl font-medium text-white/95 mb-5"
              style={{ fontFamily: 'var(--font-sc-display), system-ui, sans-serif', lineHeight: 1.2 }}
            >
              Sales teams that help you grow with clarity
            </h1>
            <p className="text-base md:text-lg mb-9 max-w-xl" style={{ color: 'rgba(255,255,255,0.78)' }}>
              Dedicated outbound teams that generate qualified leads, handle calls, and drive
              revenue — managed end to end through our sales portal at crm.shakyaconsultants.com.
            </p>
            <div className="flex flex-col sm:flex-row gap-3">
              <a
                href="#contact"
                onClick={(e) => {
                  e.preventDefault()
                  smoothScroll('#contact')
                }}
                className="inline-flex items-center justify-center gap-2 px-7 py-3.5 text-base font-semibold transition-opacity hover:opacity-90"
                style={{
                  backgroundColor: 'var(--sc-white)',
                  color: 'var(--sc-brand)',
                  borderRadius: '8px',
                }}
              >
                Get in touch <ArrowRight size={18} />
              </a>
              <a
                href="#services"
                onClick={(e) => {
                  e.preventDefault()
                  smoothScroll('#services')
                }}
                className="inline-flex items-center justify-center gap-2 px-7 py-3.5 text-base font-medium text-white transition-colors"
                style={{
                  border: '1px solid rgba(255,255,255,0.35)',
                  borderRadius: '8px',
                }}
              >
                Our services <ChevronDown size={18} />
              </a>
            </div>
          </div>
        </div>
      </section>

      {/* ── STATS ── */}
      <section style={{ backgroundColor: 'var(--sc-white)', borderBottom: '1px solid var(--sc-line)' }}>
        <div className="max-w-6xl mx-auto px-5 lg:px-8 py-12 md:py-14 grid grid-cols-2 md:grid-cols-4 gap-8 md:gap-6">
          {STATS.map((s) => (
            <motion.div key={s.label} className="text-center md:text-left" {...motionProps}>
              <div
                className="text-3xl md:text-4xl font-bold mb-1.5 tracking-tight"
                style={{
                  fontFamily: 'var(--font-sc-display), system-ui, sans-serif',
                  color: 'var(--sc-brand)',
                }}
              >
                {s.value}
              </div>
              <div className="text-sm" style={{ color: 'var(--sc-muted)' }}>
                {s.label}
              </div>
            </motion.div>
          ))}
        </div>
      </section>

      {/* ── SERVICES ── */}
      <section id="services" className="py-20 md:py-28" style={{ backgroundColor: 'var(--sc-paper)' }}>
        <div className="max-w-6xl mx-auto px-5 lg:px-8">
          <motion.div className="max-w-2xl mb-14" {...motionProps}>
            <h2
              className="text-3xl md:text-5xl font-bold tracking-tight mb-4"
              style={{ fontFamily: 'var(--font-sc-display), system-ui, sans-serif', color: 'var(--sc-ink)' }}
            >
              Full-service sales outsourcing
            </h2>
            <p className="text-lg" style={{ color: 'var(--sc-muted)' }}>
              From first call to closed deal, we handle every step of the sales process for your
              business.
            </p>
          </motion.div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-x-12 gap-y-0">
            {SERVICES.map((svc, i) => (
              <motion.div
                key={svc.title}
                className="flex gap-4 py-8"
                style={{
                  borderTop: i < 2 ? '1px solid var(--sc-line)' : undefined,
                  borderBottom: '1px solid var(--sc-line)',
                }}
                {...motionProps}
                transition={{
                  duration: 0.55,
                  delay: reduceMotion ? 0 : i * 0.05,
                  ease: [0.22, 1, 0.36, 1],
                }}
              >
                <div
                  className="flex h-11 w-11 shrink-0 items-center justify-center rounded-md"
                  style={{ backgroundColor: 'var(--sc-fog)', color: 'var(--sc-accent)' }}
                >
                  <svc.icon size={20} strokeWidth={1.75} />
                </div>
                <div>
                  <h3 className="text-lg font-semibold mb-2" style={{ color: 'var(--sc-ink)' }}>
                    {svc.title}
                  </h3>
                  <p className="text-sm leading-relaxed" style={{ color: 'var(--sc-muted)' }}>
                    {svc.desc}
                  </p>
                </div>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* ── WHY US ── */}
      <section
        id="why-us"
        className="py-20 md:py-28"
        style={{ backgroundColor: 'var(--sc-ink)', color: 'var(--sc-paper)' }}
      >
        <div className="max-w-6xl mx-auto px-5 lg:px-8">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-14 lg:gap-20 items-start">
            <motion.div {...motionProps}>
              <h2
                className="text-3xl md:text-5xl font-bold tracking-tight mb-5"
                style={{ fontFamily: 'var(--font-sc-display), system-ui, sans-serif' }}
              >
                Built for results, not just activity
              </h2>
              <p className="text-lg mb-8" style={{ color: 'rgba(245,247,251,0.78)' }}>
                We don&apos;t just make calls. We build structured sales processes, train our teams
                on your product, and deliver measurable outcomes tied to your growth targets.
              </p>
              <div className="flex flex-col gap-3.5">
                {WHY_POINTS.map((point) => (
                  <div key={point} className="flex items-start gap-3">
                    <CheckCircle
                      size={18}
                      style={{ color: '#8eb6e0', marginTop: '2px', flexShrink: 0 }}
                    />
                    <span className="text-sm" style={{ color: 'rgba(245,247,251,0.88)' }}>
                      {point}
                    </span>
                  </div>
                ))}
              </div>
            </motion.div>

            <motion.div
              className="grid grid-cols-2 gap-px overflow-hidden rounded-lg"
              style={{ backgroundColor: 'rgba(245,247,251,0.12)' }}
              {...motionProps}
            >
              {METRICS.map((card) => (
                <div
                  key={card.label}
                  className="p-6 md:p-7"
                  style={{ backgroundColor: 'rgba(11, 18, 32, 0.45)' }}
                >
                  <div
                    className="text-3xl font-bold mb-2 tracking-tight"
                    style={{ fontFamily: 'var(--font-sc-display), system-ui, sans-serif' }}
                  >
                    {card.value}
                  </div>
                  <div className="text-sm font-medium mb-1">{card.label}</div>
                  <div className="text-xs" style={{ color: 'rgba(245,247,251,0.55)' }}>
                    {card.sub}
                  </div>
                </div>
              ))}
            </motion.div>
          </div>
        </div>
      </section>

      {/* ── HOW IT WORKS ── */}
      <section id="how-it-works" className="py-20 md:py-28" style={{ backgroundColor: 'var(--sc-white)' }}>
        <div className="max-w-6xl mx-auto px-5 lg:px-8">
          <motion.div className="max-w-2xl mb-14" {...motionProps}>
            <h2
              className="text-3xl md:text-5xl font-bold tracking-tight mb-4"
              style={{ fontFamily: 'var(--font-sc-display), system-ui, sans-serif', color: 'var(--sc-ink)' }}
            >
              Up and running in days, not months
            </h2>
            <p className="text-lg" style={{ color: 'var(--sc-muted)' }}>
              A clear path from discovery to live campaigns — without the usual setup drag.
            </p>
          </motion.div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-10 md:gap-8">
            {STEPS.map((step, i) => (
              <motion.div
                key={step.num}
                {...motionProps}
                transition={{
                  duration: 0.55,
                  delay: reduceMotion ? 0 : i * 0.08,
                  ease: [0.22, 1, 0.36, 1],
                }}
              >
                <div
                  className="text-sm font-semibold tracking-[0.18em] mb-4"
                  style={{ color: 'var(--sc-accent)' }}
                >
                  {step.num}
                </div>
                <h3
                  className="text-xl font-bold mb-3"
                  style={{
                    fontFamily: 'var(--font-sc-display), system-ui, sans-serif',
                    color: 'var(--sc-ink)',
                  }}
                >
                  {step.title}
                </h3>
                <p className="text-sm leading-relaxed" style={{ color: 'var(--sc-muted)' }}>
                  {step.desc}
                </p>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* ── CONTACT CTA ── */}
      <section
        id="contact"
        className="py-20 md:py-28 relative overflow-hidden"
        style={{ backgroundColor: 'var(--sc-fog)' }}
      >
        <div
          className="absolute inset-0 pointer-events-none"
          style={{
            background:
              'radial-gradient(ellipse 60% 80% at 100% 0%, rgba(47,111,173,0.14), transparent 55%)',
          }}
        />
        <motion.div className="relative max-w-3xl mx-auto px-5 lg:px-8 text-center" {...motionProps}>
          <h2
            className="text-3xl md:text-5xl font-bold tracking-tight mb-5"
            style={{ fontFamily: 'var(--font-sc-display), system-ui, sans-serif', color: 'var(--sc-ink)' }}
          >
            Ready to grow your revenue?
          </h2>
          <p className="text-lg mb-10" style={{ color: 'var(--sc-muted)' }}>
            Speak with our team today and find out how Shakya Consultants can build a dedicated
            sales operation for your business.
          </p>
          <div className="flex flex-col sm:flex-row gap-3 justify-center mb-12">
            <a
              href="mailto:hello@shakyaconsultants.com"
              className="inline-flex items-center justify-center gap-2 px-7 py-3.5 text-base font-semibold transition-opacity hover:opacity-90"
              style={{
                backgroundColor: 'var(--sc-brand)',
                color: 'var(--sc-white)',
                borderRadius: '8px',
              }}
            >
              <Mail size={18} /> Email Us
            </a>
            <Link
              href="/crm-access"
              className="inline-flex items-center justify-center gap-2 px-7 py-3.5 text-base font-semibold transition-colors"
              style={{
                border: '1px solid var(--sc-line)',
                color: 'var(--sc-brand)',
                backgroundColor: 'var(--sc-white)',
                borderRadius: '8px',
              }}
            >
              CRM Access <ArrowRight size={16} />
            </Link>
          </div>

          <div
            className="flex flex-col sm:flex-row gap-5 sm:gap-8 justify-center text-sm"
            style={{ color: 'var(--sc-muted)' }}
          >
            <div className="flex items-center gap-2 justify-center">
              <Mail size={15} style={{ color: 'var(--sc-accent)' }} />
              hello@shakyaconsultants.com
            </div>
            <div className="flex items-center gap-2 justify-center">
              <MapPin size={15} style={{ color: 'var(--sc-accent)' }} />
              Kanpur, India
            </div>
            <div className="flex items-center gap-2 justify-center">
              <Globe size={15} style={{ color: 'var(--sc-accent)' }} />
              crm.shakyaconsultants.com
            </div>
          </div>
        </motion.div>
      </section>

      {/* ── FOOTER ── */}
      <footer style={{ borderTop: '1px solid var(--sc-line)', backgroundColor: 'var(--sc-white)' }}>
        <div className="max-w-6xl mx-auto px-5 lg:px-8 py-8 flex flex-col md:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-2.5">
            <img
              src="/logo.png"
              alt="Shakya Consultants"
              className="h-10 w-auto max-w-[200px] object-contain"
            />
          </div>
          <p className="text-xs text-center" style={{ color: 'var(--sc-muted)' }}>
            © {new Date().getFullYear()} Shakya Consultants. All rights reserved.
          </p>
          <Link
            href="/login"
            className="text-xs font-medium transition-colors"
            style={{ color: 'var(--sc-accent)' }}
          >
            Team Login →
          </Link>
        </div>
      </footer>
    </div>
  )
}
