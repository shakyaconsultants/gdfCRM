import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { jwtVerify } from 'jose'
import cloudinary, { isCloudinaryConfigured } from '@/lib/cloudinary'
import { getJwtSecret } from '@/lib/jwt-secret'
import {
  ALLOWED_LEAD_IMPORT_MIME,
  MAX_CSV_IMPORT_BYTES,
  hasAllowedMime,
} from '@/lib/upload-security'

const secret = getJwtSecret()
const LOG_SCOPE = 'ADMIN UPLOAD'

export const runtime = 'nodejs'
export const maxDuration = 60

function isAllowedImportFile(file: File): boolean {
  const name = file.name.toLowerCase()
  if (name.endsWith('.csv') || name.endsWith('.xlsx')) return true
  return hasAllowedMime(file.type || '', ALLOWED_LEAD_IMPORT_MIME)
}

function friendlyUploadError(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err ?? '')
  const lower = raw.toLowerCase()

  if (lower.includes('timeout') || lower.includes('timed out')) {
    return 'Upload timed out. Try a smaller file or check your connection.'
  }
  if (lower.includes('file size') || lower.includes('too large')) {
    return 'File is too large. Maximum size is 8 MB.'
  }
  if (lower.includes('invalid') && lower.includes('image')) {
    return 'Could not store this file. Use a .csv or .xlsx lead file.'
  }
  return 'Could not upload the file. Try again or export as CSV.'
}

export async function POST(req: NextRequest) {
  const token = req.cookies.get('token')?.value
  if (!token) {
    return NextResponse.json({ error: 'Session expired — please log in again as admin.' }, { status: 401 })
  }

  try {
    const { payload } = await jwtVerify(token, secret)
    if (payload.role !== 'ADMIN') {
      return NextResponse.json({ error: 'Only admins can upload lead files.' }, { status: 403 })
    }

    if (!isCloudinaryConfigured()) {
      console.error(`[${LOG_SCOPE}] Cloudinary env vars missing`)
      return NextResponse.json(
        {
          error:
            'File storage is not configured on the server. Ask your administrator to set up Cloudinary.',
        },
        { status: 503 }
      )
    }

    const formData = await req.formData()
    const file = formData.get('file')

    if (!file || typeof file === 'string') {
      return NextResponse.json({ error: 'No file was selected. Choose a .csv or .xlsx file.' }, { status: 400 })
    }

    const uploadFile = file as File
    const fileName = uploadFile.name || 'unknown'

    if (fileName.toLowerCase().endsWith('.xls') && !fileName.toLowerCase().endsWith('.xlsx')) {
      return NextResponse.json(
        { error: 'Old .xls Excel format is not supported. Save as .xlsx or export as CSV.' },
        { status: 400 }
      )
    }

    if (!isAllowedImportFile(uploadFile)) {
      console.warn(`[${LOG_SCOPE}] rejected type name=${fileName} mime=${uploadFile.type || 'none'}`)
      return NextResponse.json(
        { error: 'Unsupported file type. Upload a .csv or .xlsx file.' },
        { status: 400 }
      )
    }

    if (uploadFile.size === 0) {
      return NextResponse.json({ error: 'The file is empty.' }, { status: 400 })
    }

    if (uploadFile.size > MAX_CSV_IMPORT_BYTES) {
      return NextResponse.json({ error: 'File is too large. Maximum size is 8 MB.' }, { status: 400 })
    }

    const bytes = await uploadFile.arrayBuffer()
    const buffer = Buffer.from(bytes)

    const result = await new Promise<unknown>((resolve, reject) => {
      const uploadStream = cloudinary.uploader.upload_stream(
        { resource_type: 'raw', folder: 'crm_leads' },
        (error, uploadResult) => {
          if (error) reject(error)
          else resolve(uploadResult)
        }
      )
      uploadStream.end(buffer)
    })

    console.log(`[${LOG_SCOPE}] ok name=${fileName} bytes=${uploadFile.size}`)
    return NextResponse.json({ success: true, result })
  } catch (error) {
    console.error(`[${LOG_SCOPE}] failed`, error)
    return NextResponse.json({ error: friendlyUploadError(error) }, { status: 500 })
  }
}
