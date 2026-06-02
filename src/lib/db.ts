import { PrismaClient } from '@prisma/client'
import { mkdir } from 'fs/promises'
import { join, dirname } from 'path'

// Ensure the database directory exists (important for Render/production)
async function ensureDbDir() {
  const dbUrl = process.env.DATABASE_URL || 'file:./db/custom.db'
  const match = dbUrl.match(/file:(.+)/)
  if (match) {
    const dbPath = match[1].replace(/^\/+/, '')
    const absPath = join(process.cwd(), dbPath)
    const dir = dirname(absPath)
    try {
      await mkdir(dir, { recursive: true })
    } catch {
      // Directory may already exist or be read-only during build
    }
  }
}

// Ensure db directory exists before Prisma connects
ensureDbDir().catch(() => {})

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
}

export const db =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV !== 'production' ? ['query'] : [],
  })

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = db
