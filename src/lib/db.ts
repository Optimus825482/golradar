import { PrismaClient } from '@prisma/client'

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
}

export const db =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === 'development' ? ['query'] : ['error', 'warn'],
  })

// Faz 2 — her ortamda global cache. Serverless'da hot instance reuse için gerekli;
// aksi halde production cold-start'larda her invocation yeni PrismaClient oluşturur.
globalForPrisma.prisma = db