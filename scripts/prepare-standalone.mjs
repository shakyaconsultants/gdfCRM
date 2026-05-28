/**
 * After `next build` with output: 'standalone', copies assets the standalone
 * server does not include automatically. Run via npm postbuild.
 */
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.join(__dirname, '..')
const standalone = path.join(root, '.next', 'standalone')
const standaloneServer = path.join(standalone, 'server.js')

if (!fs.existsSync(standaloneServer)) {
  console.error('[prepare-standalone] Missing .next/standalone/server.js — run `npm run build` first.')
  process.exit(1)
}

function copyRecursive(src, dest, label) {
  if (!fs.existsSync(src)) {
    console.warn(`[prepare-standalone] Skip ${label}: not found (${src})`)
    return
  }
  fs.mkdirSync(path.dirname(dest), { recursive: true })
  fs.cpSync(src, dest, { recursive: true })
  console.log(`[prepare-standalone] Copied ${label}`)
}

copyRecursive(
  path.join(root, '.next', 'static'),
  path.join(standalone, '.next', 'static'),
  '.next/static → standalone/.next/static'
)

copyRecursive(
  path.join(root, 'public'),
  path.join(standalone, 'public'),
  'public → standalone/public'
)

copyRecursive(
  path.join(root, 'prisma'),
  path.join(standalone, 'prisma'),
  'prisma → standalone/prisma'
)

console.log('')
console.log('[prepare-standalone] Standalone bundle ready at .next/standalone')
console.log('[prepare-standalone] Start: npm start  (runs root server.js → standalone server)')
console.log(
  '[prepare-standalone] Tip: build on Linux (or same OS as cPanel) so Prisma engine binaries match the host.'
)
