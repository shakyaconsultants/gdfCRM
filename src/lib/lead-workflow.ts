export const LEAD_DISPOSITIONS = [
  'New',
  'Pre Hangup',
  'Hangup',
  'Not Interested',
  'No Answer',
  'Callback',
  'Busy',
  'Line Irresponsive',
  'Switch Off',
  'Not connected',
  'Voicemail',
  'Wrong Number',
  'Low Debts',
  'No Debts',
  'Managing Fine',
  'Have Debts & Hang up',
  'Already in a plan',
  'Prospect',
] as const

export type LeadDisposition = (typeof LEAD_DISPOSITIONS)[number]

export const CASE_STATUSES = ['PENDING', 'REFERRED', 'VERIFIED', 'CLAWBACK'] as const
export type CaseStatus = (typeof CASE_STATUSES)[number]

export type CaseChecklist = {
  incomeMonthly: string
  incomeEligible: boolean
  employmentStatus: 'FULL_TIME' | 'PART_TIME' | 'SELF_EMPLOYED' | 'BENEFIT' | ''
  payslipVerified: boolean
  universalCreditStatementUploaded: boolean
  universalCreditVisible: boolean
  livingStatus: 'SINGLE' | 'PARTNER' | ''
  hasKids: boolean
  kidsDob: string[]
  hasCar: boolean
  carRegistration: string
  idProofType: 'PASSPORT' | 'DRIVING_LICENCE' | ''
  nonEnglish: boolean
  rightToRemainUploaded: boolean
  amlCheckRequired: boolean
  debtLevel: string
  debtPlan: 'DISSOLVE_DEBT' | 'DM' | ''
  threeWayCallCompleted: boolean
  notes: string
}

export function emptyCaseChecklist(): CaseChecklist {
  return {
    incomeMonthly: '',
    incomeEligible: false,
    employmentStatus: '',
    payslipVerified: false,
    universalCreditStatementUploaded: false,
    universalCreditVisible: false,
    livingStatus: '',
    hasKids: false,
    kidsDob: [],
    hasCar: false,
    carRegistration: '',
    idProofType: '',
    nonEnglish: false,
    rightToRemainUploaded: false,
    amlCheckRequired: false,
    debtLevel: '',
    debtPlan: '',
    threeWayCallCompleted: false,
    notes: '',
  }
}

export function parseCaseChecklist(input: unknown): CaseChecklist {
  const base = emptyCaseChecklist()
  if (!input || typeof input !== 'object') return base
  const o = input as Record<string, unknown>

  const employmentStatus =
    o.employmentStatus === 'FULL_TIME' ||
    o.employmentStatus === 'PART_TIME' ||
    o.employmentStatus === 'SELF_EMPLOYED' ||
    o.employmentStatus === 'BENEFIT'
      ? o.employmentStatus
      : ''

  const livingStatus =
    o.livingStatus === 'SINGLE' || o.livingStatus === 'PARTNER' ? o.livingStatus : ''
  const idProofType =
    o.idProofType === 'PASSPORT' || o.idProofType === 'DRIVING_LICENCE' ? o.idProofType : ''
  const debtPlan = o.debtPlan === 'DISSOLVE_DEBT' || o.debtPlan === 'DM' ? o.debtPlan : ''

  return {
    incomeMonthly: typeof o.incomeMonthly === 'string' ? o.incomeMonthly : '',
    incomeEligible: o.incomeEligible === true,
    employmentStatus,
    payslipVerified: o.payslipVerified === true,
    universalCreditStatementUploaded: o.universalCreditStatementUploaded === true,
    universalCreditVisible: o.universalCreditVisible === true,
    livingStatus,
    hasKids: o.hasKids === true,
    kidsDob: Array.isArray(o.kidsDob) ? o.kidsDob.filter((x) => typeof x === 'string') : [],
    hasCar: o.hasCar === true,
    carRegistration: typeof o.carRegistration === 'string' ? o.carRegistration : '',
    idProofType,
    nonEnglish: o.nonEnglish === true,
    rightToRemainUploaded: o.rightToRemainUploaded === true,
    amlCheckRequired: o.amlCheckRequired === true,
    debtLevel: typeof o.debtLevel === 'string' ? o.debtLevel : '',
    debtPlan,
    threeWayCallCompleted: o.threeWayCallCompleted === true,
    notes: typeof o.notes === 'string' ? o.notes : '',
  }
}

/** True if checklist has any meaningful field filled (for list badges without sending full JSON). */
export function caseChecklistHasData(input: unknown): boolean {
  const c = parseCaseChecklist(input)
  return Boolean(
    c.incomeMonthly ||
      c.employmentStatus ||
      c.kidsDob.length ||
      c.carRegistration ||
      c.idProofType ||
      c.debtLevel ||
      c.debtPlan ||
      c.notes ||
      c.incomeEligible ||
      c.payslipVerified
  )
}
