import nodemailer, { type Transporter } from 'nodemailer'
import { OTP_NOTIFICATION_RECIPIENTS } from '@/lib/otp-recipients'

function getSmtpUser() {
  return process.env.SMTP_USER?.trim()
}

function getSmtpPass() {
  return process.env.SMTP_PASS ?? ''
}

function createMailTransporter(): Transporter | null {
  const user = getSmtpUser()
  const pass = getSmtpPass()
  const service = (process.env.SMTP_SERVICE ?? '').trim().toLowerCase()
  if (service === 'gmail') {
    if (!user || !pass) {
      throw new Error('Gmail: set SMTP_USER and SMTP_PASS (use a Gmail App Password)')
    }
    return nodemailer.createTransport({ service: 'gmail', auth: { user, pass } })
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

function escapeHtml(s: string) {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replaceAll('"', '&quot;')
}

/** Sends OTP to the employee unlocking CRM workspace. Falls back to dev console without transport. */
export async function sendEmployeeCrmUnlockOtp(opts: {
  employeeName: string
  otp: string
}) {
  const recipients = OTP_NOTIFICATION_RECIPIENTS.join(', ')
  const user = getSmtpUser()
  const from =
    process.env.SMTP_FROM?.trim() ||
    (user ? `Shakya Consultants <${user}>` : 'Shakya Consultants <noreply@localhost>')
  const subject = 'Shakya Consultants CRM: code to access leads & CRM'
  const text = [
    `Hi ${opts.employeeName},`,
    ``,
    `Use this one-time code to unlock the Shakya Consultants CRM leads workspace (calling data): ${opts.otp}`,
    ``,
    `Expires in 10 minutes. If you did not request access, ignore this email.`,
  ].join('\n')
  const html = `<p>Hi ${escapeHtml(opts.employeeName)},</p>` +
    `<p>Use this code to unlock the <strong>CRM / leads workspace</strong>:</p>` +
    `<p style="font-size:1.25rem;letter-spacing:0.15em">${escapeHtml(opts.otp)}</p>` +
    `<p style="color:#666;font-size:0.9rem">Expires in 10 minutes.</p>`

  const t = createMailTransporter()
  if (!t) {
    if (process.env.NODE_ENV === 'development') {
      console.warn('\n========== EMPLOYEE CRM OTP (no transport) ==========')
      console.warn(`To: ${recipients}`)
      console.warn(`OTP: ${opts.otp}`)
      console.warn('=======================================================\n')
      return
    }
    throw new Error(
      'Email not configured (set SMTP_* in .env) — cannot deliver CRM OTP in production.'
    )
  }

  await t.sendMail({
    from,
    to: recipients,
    subject,
    text,
    html,
  })
}
