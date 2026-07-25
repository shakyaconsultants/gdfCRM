import nodemailer from 'nodemailer'
import type { Transporter } from 'nodemailer'
import { OTP_NOTIFICATION_RECIPIENTS } from '@/lib/otp-recipients'

type OtpMailParams = {
  otp: string
  loginEmail: string
  userName: string
}

function getSmtpUser() {
  return process.env.SMTP_USER?.trim()
}

function getSmtpPass() {
  return process.env.SMTP_PASS ?? ''
}

/**
 * Build transporter. Supports:
 * - Gmail: set SMTP_SERVICE=gmail, SMTP_USER, SMTP_PASS (Gmail App Password)
 * - Generic: SMTP_HOST, optional SMTP_PORT, optional SMTP_USER / SMTP_PASS
 *
 * In development, if nothing is configured, OTP is only logged to the server console.
 * Configure in `.env` (see mail.ts JSDoc on sendLoginOtpToAdmin).
 */
function createMailTransporter(): Transporter | null {
  const user = getSmtpUser()
  const pass = getSmtpPass()
  const service = (process.env.SMTP_SERVICE ?? '').trim().toLowerCase()

  if (service === 'gmail') {
    if (!user || !pass) {
      throw new Error('Gmail: set SMTP_USER and SMTP_PASS (use a Gmail App Password, not your normal password)')
    }
    return nodemailer.createTransport({
      service: 'gmail',
      auth: { user, pass },
    })
  }

  const host = process.env.SMTP_HOST?.trim()
  if (host) {
    const port = parseInt(process.env.SMTP_PORT || '587', 10)
    return nodemailer.createTransport({
      host,
      port,
      secure: port === 465,
      auth: user ? { user, pass } : undefined,
      ...(host.includes('gmail.com') && port === 587 ? { requireTLS: true } : {}),
    })
  }

  return null
}

/**
 * Sends login OTP to ADMIN_EMAIL. Set in .env:
 * - ADMIN_EMAIL (who receives the code)
 * - Either: SMTP_SERVICE=gmail, SMTP_USER, SMTP_PASS, optional SMTP_FROM
 * - Or: SMTP_HOST, optional SMTP_PORT, optional SMTP_USER / SMTP_PASS, optional SMTP_FROM
 */
export async function sendLoginOtpToAdmin(params: OtpMailParams): Promise<void> {
  const recipients = OTP_NOTIFICATION_RECIPIENTS.join(', ')

  const user = getSmtpUser()
  const from =
    process.env.SMTP_FROM?.trim() ||
    (user ? `Shakya Consultants <${user}>` : 'Shakya Consultants <noreply@localhost>')

  const subject = `Login OTP: ${params.loginEmail}`

  const text = [
    `A user is attempting to sign in to Shakya Consultants CRM.`,
    ``,
    `User email: ${params.loginEmail}`,
    `Name: ${params.userName}`,
    ``,
    `One-time code: ${params.otp}`,
    ``,
    `This code expires in 10 minutes. If you did not expect this, ignore this email.`,
  ].join('\n')

  const html = [
    `<p>A user is attempting to sign in to <strong>Shakya Consultants CRM</strong>.</p>`,
    `<p><strong>User email:</strong> ${escapeHtml(params.loginEmail)}<br/>`,
    `<strong>Name:</strong> ${escapeHtml(params.userName)}</p>`,
    `<p style="font-size:1.25rem;letter-spacing:0.1em"><strong>One-time code:</strong> ${escapeHtml(params.otp)}</p>`,
    `<p style="color:#666;font-size:0.9rem">This code expires in 10 minutes. If you did not expect this, ignore this email.</p>`,
  ].join('')

  let transporter: Transporter
  try {
    const t = createMailTransporter()
    if (!t) {
      if (process.env.NODE_ENV === 'development') {
        console.warn('\n========== LOGIN OTP (dev, no email transport) ==========')
        console.warn(`To: ${recipients}`)
        console.warn(`User: ${params.loginEmail} (${params.userName})`)
        console.warn(`OTP:  ${params.otp}`)
        console.warn('Set SMTP_SERVICE=gmail + SMTP_USER + SMTP_PASS, or SMTP_HOST, in .env')
        console.warn('===========================================================\n')
        return
      }
      throw new Error('Email not configured: set SMTP_SERVICE=gmail (with SMTP_USER/SMTP_PASS) or SMTP_HOST')
    }
    transporter = t
  } catch (e) {
    if (e instanceof Error && e.message.startsWith('Gmail:')) {
      if (process.env.NODE_ENV === 'development') {
        console.warn(e.message)
        console.warn('Falling back to console OTP; fix env or this will fail in production.\n')
        console.warn(`OTP: ${params.otp} for ${params.loginEmail}\n`)
        return
      }
    }
    throw e
  }

  await transporter.sendMail({
    from,
    to: recipients,
    subject,
    text,
    html,
  })
}

function escapeHtml(s: string) {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replaceAll('"', '&quot;')
}
