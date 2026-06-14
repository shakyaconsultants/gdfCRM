import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { jwtVerify } from 'jose'
import { db } from '@/lib/db'
import cloudinary, { isCloudinaryConfigured } from '@/lib/cloudinary'
import { getJwtSecret } from '@/lib/jwt-secret'
import { checkRateLimit, getClientIp } from '@/lib/rate-limit'
import {
  ALLOWED_LEAD_DOCUMENT_MIME,
  MAX_LEAD_DOCUMENT_BYTES,
  hasAllowedMime,
} from '@/lib/upload-security'

const secret = getJwtSecret()

export const runtime = 'nodejs'
/** Vercel Pro+; Hobby is capped at 10s — still avoids default 10s edge cases for large files. */
export const maxDuration = 60

async function getAdvisorLead(advisorId: string, leadId: string) {
  return db.lead.findFirst({
    where: {
      id: leadId,
      assignedAdvisorId: advisorId,
      moveToAdvisor: true,
    },
  })
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const token = req.cookies.get('token')?.value
  if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  try {
    const { payload } = await jwtVerify(token, secret)
    if (payload.role !== 'ADVISOR') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
    const advisorId = payload.id as string
    const { id: leadId } = await params

    const lead = await getAdvisorLead(advisorId, leadId)
    if (!lead) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

    const documents = await db.leadDocument.findMany({
      where: { leadId },
      orderBy: { createdAt: 'desc' },
      take: 50,
    })

    return NextResponse.json({ documents })
  } catch (error) {
    console.error(error)
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const token = req.cookies.get('token')?.value
  if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  try {
    const { payload } = await jwtVerify(token, secret)
    if (payload.role !== 'ADVISOR') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
    const advisorId = payload.id as string
    const { id: leadId } = await params

    // Audit SEC-8: per-advisor upload rate limit.
    const rl = await checkRateLimit({
      key: `upload:lead-doc:${advisorId}:${getClientIp(req)}`,
      limit: 40,
      windowMs: 10 * 60 * 1000,
    })
    if (!rl.allowed) {
      return NextResponse.json(
        { error: 'Too many uploads. Please wait and try again.' },
        { status: 429, headers: { 'Retry-After': String(rl.retryAfterSec) } }
      )
    }

    const lead = await getAdvisorLead(advisorId, leadId)
    if (!lead) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

    if (!isCloudinaryConfigured()) {
      return NextResponse.json(
        {
          error:
            'File storage is not configured. Add CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, and CLOUDINARY_API_SECRET to your Vercel project environment variables and redeploy.',
        },
        { status: 503 }
      )
    }

    const formData = await req.formData()
    const fileEntry = formData.get('file')
    // Audit LOW-4: validate it's actually a file before using it.
    if (!fileEntry || !(fileEntry instanceof Blob)) {
      return NextResponse.json({ error: 'No file provided' }, { status: 400 })
    }
    const file = fileEntry as File
    if (!file.size) {
      return NextResponse.json({ error: 'No file provided' }, { status: 400 })
    }
    if (!hasAllowedMime(file.type || '', ALLOWED_LEAD_DOCUMENT_MIME)) {
      return NextResponse.json({ error: 'Unsupported file type.' }, { status: 400 })
    }
    if (file.size > MAX_LEAD_DOCUMENT_BYTES) {
      return NextResponse.json({ error: 'File too large. Max size is 12MB.' }, { status: 400 })
    }

    const bytes = await file.arrayBuffer()
    const buffer = Buffer.from(bytes)
    const folder = `crm_lead_documents/${leadId}`

    const result = await new Promise<{
      secure_url?: string
      public_id?: string
      resource_type?: string
    }>((resolve, reject) => {
      const uploadStream = cloudinary.uploader.upload_stream(
        {
          folder,
          resource_type: 'auto',
          use_filename: true,
          unique_filename: true,
        },
        (error, res) => {
          if (error) reject(error)
          else resolve(res as { secure_url?: string; public_id?: string; resource_type?: string })
        }
      )
      uploadStream.end(buffer)
    })

    if (!result.secure_url || !result.public_id) {
      return NextResponse.json({ error: 'Upload failed' }, { status: 500 })
    }

    const doc = await db.leadDocument.create({
      data: {
        leadId,
        fileName: file.name || 'file',
        url: result.secure_url,
        publicId: result.public_id,
        resourceType: result.resource_type || 'raw',
        mimeType: file.type || null,
      },
    })

    return NextResponse.json({ success: true, document: doc })
  } catch (error) {
    console.error('Lead document upload:', error)
    const message =
      error instanceof Error ? error.message : 'Upload failed'
    return NextResponse.json({ error: message || 'Upload failed' }, { status: 500 })
  }
}
