import { PrismaClient } from '@prisma/client'

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
}

function createClient() {
  return new PrismaClient({
    log: process.env.NODE_ENV === 'development' ? ['error', 'warn'] : [],
  })
}

if (process.env.NODE_ENV === 'development') {
  if (globalForPrisma.prisma) {
    void globalForPrisma.prisma.$disconnect().catch(() => {})
  }
  globalForPrisma.prisma = createClient()
} else {
  if (!globalForPrisma.prisma) {
    globalForPrisma.prisma = createClient()
  }
}

export const db = globalForPrisma.prisma!
