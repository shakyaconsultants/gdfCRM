/**
 * Production entry for cPanel / VPS.
 *
 * Uses the Next.js standalone bundle (.next/standalone)
 */

'use strict'

const path = require('path')
const { existsSync, readFileSync } = require('fs')

// Limit threads/memory on shared cPanel (helps Prisma/Tokio "resource unavailable")
if (!process.env.UV_THREADPOOL_SIZE) process.env.UV_THREADPOOL_SIZE = '4'
if (!process.env.NODE_OPTIONS?.includes('max-old-space-size')) {
  process.env.NODE_OPTIONS = [process.env.NODE_OPTIONS, '--max-old-space-size=768']
    .filter(Boolean)
    .join(' ')
}

const rootDir = __dirname

function loadEnvFile(filePath) {
  if (!existsSync(filePath)) return

  const text = readFileSync(filePath, 'utf8')

  for (const line of text.split('\n')) {
    const trimmed = line.trim()

    if (!trimmed || trimmed.startsWith('#')) continue

    const eq = trimmed.indexOf('=')

    if (eq === -1) continue

    const key = trimmed.slice(0, eq).trim()

    let val = trimmed.slice(eq + 1).trim()

    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1)
    }

    if (process.env[key] === undefined) {
      process.env[key] = val
    }
  }
}

loadEnvFile(path.join(rootDir, '.env'))
loadEnvFile(path.join(rootDir, '.env.local'))
loadEnvFile(path.join(rootDir, '.env.production'))

const standaloneDir = path.join(rootDir, '.next', 'standalone')
const standaloneServer = path.join(standaloneDir, 'server.js')

if (!existsSync(standaloneServer)) {
  console.error(
    '[crm] Missing .next/standalone/server.js\n' +
    '[crm] Run: npm run build'
  )

  process.exit(1)
}

process.env.NODE_ENV =
  process.env.NODE_ENV || 'production'

process.env.HOSTNAME =
  process.env.HOSTNAME || '0.0.0.0'

if (!process.env.PORT) {
  process.env.PORT = '3000'
}

process.env.PROJECT_ROOT = rootDir

let shuttingDown = false

function shutdown(signal) {
  if (shuttingDown) return

  shuttingDown = true

  console.log(`[crm] ${signal} received, exiting`)

  setTimeout(() => process.exit(0), 250).unref()
}

process.on('SIGTERM', () => shutdown('SIGTERM'))
process.on('SIGINT', () => shutdown('SIGINT'))

process.chdir(standaloneDir)

console.log(
  `[crm] Starting standalone (host=${process.env.HOSTNAME} port=${process.env.PORT} threads=${process.env.UV_THREADPOOL_SIZE})`
)

require('./server.js')