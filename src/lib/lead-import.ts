import { MAX_CSV_IMPORT_BYTES } from '@/lib/upload-security'
import { parseLeadPhoneForStorage } from '@/lib/phone'

export const LEAD_IMPORT_ACCEPT = '.xlsx,.csv'

export type LeadImportRow = {
  title: string
  firstName: string
  lastName: string
  email: string
  addressLine1: string
  addressLine2: string
  addressLine3: string
  addressLine4: string
  address: string
  postCode: string
  phone: string
  remarks: string
}

/** Client-side validation before parse/upload. Returns user message or null if OK. */
export function validateLeadImportFile(file: File): string | null {
  const name = file.name.toLowerCase()

  if (name.endsWith('.xls') && !name.endsWith('.xlsx')) {
    return 'Old Excel .xls format is not supported. Open the file in Excel and Save As .xlsx, or export as CSV.'
  }
  if (!name.endsWith('.csv') && !name.endsWith('.xlsx')) {
    return 'Unsupported file type. Please upload a .csv or .xlsx file.'
  }
  if (file.size === 0) {
    return 'The file is empty.'
  }
  if (file.size > MAX_CSV_IMPORT_BYTES) {
    return 'File is too large. Maximum size is 8 MB.'
  }
  return null
}

/** Turn library/network errors into messages admins can act on. */
export function friendlyLeadImportError(err: unknown, fileName?: string): string {
  const raw = err instanceof Error ? err.message : String(err ?? '')
  const lower = raw.toLowerCase()
  const file = fileName ? ` (${fileName})` : ''

  if (lower.includes('not map') || lower.includes('is not a map')) {
    return `Could not read this Excel file${file}. Save it as a new .xlsx workbook (Excel format) or export as CSV. Exports from some tools use a format this importer cannot read.`
  }
  if (
    lower.includes('invalid signature') ||
    lower.includes('corrupt') ||
    lower.includes('end of central directory') ||
    lower.includes('zip')
  ) {
    return `The file appears corrupted or is not a valid .xlsx workbook${file}. Try re-downloading it or export as CSV.`
  }
  if (lower.includes('unsupported') || lower.includes('unknown file')) {
    return `Unsupported file format${file}. Use .csv or .xlsx only.`
  }
  if (lower.includes('failed to fetch') || lower.includes('networkerror')) {
    return 'Network error while uploading. Check your connection and try again.'
  }
  if (lower.includes('unauthorized') || lower.includes('401')) {
    return 'Session expired — please log in again as admin.'
  }
  if (lower.includes('forbidden') || lower.includes('403')) {
    return 'You do not have permission to import leads.'
  }
  if (lower.includes('storage is not configured') || lower.includes('cloudinary')) {
    return 'File storage is not configured on the server. Contact your administrator.'
  }
  if (raw.trim()) return raw.trim()
  return 'Import failed. Check the file format and try again.'
}

/** Parse CSV or XLSX into row objects keyed by header names. */
export async function parseLeadImportFile(file: File): Promise<Record<string, unknown>[]> {
  const validation = validateLeadImportFile(file)
  if (validation) throw new Error(validation)

  const lowerName = file.name.toLowerCase()

  if (lowerName.endsWith('.csv')) {
    const Papa = (await import('papaparse')).default
    const text = await file.text()
    if (!text.trim()) {
      throw new Error('The CSV file is empty.')
    }

    const parsed = Papa.parse<Record<string, unknown>>(text, {
      header: true,
      skipEmptyLines: true,
    })

    if (parsed.errors.length > 0) {
      const first = parsed.errors[0]
      const rowHint =
        first?.row != null && Number.isFinite(Number(first.row))
          ? ` (near row ${Number(first.row) + 1})`
          : ''
      throw new Error(`CSV could not be read${rowHint}: ${first?.message ?? 'Invalid CSV format'}.`)
    }

    if (!parsed.data?.length) {
      throw new Error(
        'No data rows found in the CSV. Row 1 must be column headers (e.g. Phone, First Name) and row 2+ must contain leads.'
      )
    }

    return parsed.data
  }

  try {
    const { default: readSheet } = await import('read-excel-file/browser')
    const rows = await readSheet(file)

    if (!Array.isArray(rows) || rows.length === 0) {
      throw new Error('The Excel file is empty or has no sheets with data.')
    }

    const headerRow = rows[0]
    if (!Array.isArray(headerRow)) {
      throw new Error(
        'Could not read column headers from row 1. Use the first row for names like Phone, First Name, Last Name, then save as .xlsx.'
      )
    }

    const header = headerRow.map((x) => String(x ?? '').trim())
    const namedColumns = header.filter(Boolean)
    if (namedColumns.length === 0) {
      throw new Error(
        'No column headers in row 1. Add headers such as Phone, First Name, and Last Name.'
      )
    }

    const dataRows = rows.slice(1).filter((row) => {
      if (!Array.isArray(row)) return false
      return row.some((cell) => cell != null && String(cell).trim() !== '')
    })

    if (dataRows.length === 0) {
      throw new Error('No lead rows found below the header row.')
    }

    return dataRows.map((row) => {
      const out: Record<string, unknown> = {}
      if (!Array.isArray(row)) return out
      header.forEach((key, idx) => {
        if (key) out[key] = row[idx]
      })
      return out
    })
  } catch (err) {
    if (err instanceof Error) {
      const msg = err.message
      if (
        msg.startsWith('No ') ||
        msg.startsWith('Could not') ||
        msg.startsWith('The Excel') ||
        msg.startsWith('CSV ')
      ) {
        throw err
      }
    }
    throw new Error(friendlyLeadImportError(err, file.name))
  }
}

export function mapLeadImportRows(data: Record<string, unknown>[]): LeadImportRow[] {
  return data.map((row) => {
    const raw = row.phone ?? row.Phone ?? row.Number ?? row.number ?? row.MOBILE ?? row.Mobile ?? ''
    return {
      title: String(row.title || row.Title || ''),
      firstName: String(row.firstName || row.FirstName || row['First Name'] || ''),
      lastName: String(row.lastName || row.LastName || row['Last Name'] || ''),
      email: String(row.email || row.Email || row['E-mail'] || row['Email Address'] || ''),
      addressLine1: String(
        row.addressLine1 || row['Address Line 1'] || row['Address 1'] || row.address1 || ''
      ),
      addressLine2: String(
        row.addressLine2 || row['Address Line 2'] || row['Address 2'] || row.address2 || ''
      ),
      addressLine3: String(
        row.addressLine3 || row['Address Line 3'] || row['Address 3'] || row.address3 || ''
      ),
      addressLine4: String(
        row.addressLine4 || row['Address Line 4'] || row['Address 4'] || row.address4 || ''
      ),
      address: String(row.address || row.Address || row['Full Address'] || ''),
      postCode: String(row.postCode || row.PostCode || row['Post Code'] || ''),
      phone: parseLeadPhoneForStorage(raw) ?? '',
      remarks: String(row.remarks || row.Remarks || ''),
    }
  })
}
