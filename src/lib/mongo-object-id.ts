/** 24-char hex MongoDB ObjectId (Prisma @db.ObjectId strings). */
export function isMongoObjectId(value: string): boolean {
  return /^[a-f0-9]{24}$/i.test(value)
}
