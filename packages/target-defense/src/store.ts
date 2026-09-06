import { mkdir } from "node:fs/promises"
import { dirname } from "node:path"
import type { AuditEvent, TargetDatabase, TargetRecord } from "./model.ts"

export const DEFAULT_DB = ".cyberstrike/target-shield.json"

export async function loadDb(path = DEFAULT_DB): Promise<TargetDatabase> {
  const file = Bun.file(path)
  if (!(await file.exists())) return { version: 1, targets: [], audit: [] }
  const parsed = (await file.json()) as TargetDatabase
  if (parsed.version !== 1 || !Array.isArray(parsed.targets) || !Array.isArray(parsed.audit)) {
    throw new Error(`Unsupported or corrupt Target Shield database: ${path}`)
  }
  return parsed
}

export async function saveDb(db: TargetDatabase, path = DEFAULT_DB) {
  await mkdir(dirname(path), { recursive: true })
  await Bun.write(path, `${JSON.stringify(db, null, 2)}\n`)
}

export function appendAudit(
  db: TargetDatabase,
  event: Omit<AuditEvent, "id" | "timestamp">,
): AuditEvent {
  const record: AuditEvent = {
    id: crypto.randomUUID(),
    timestamp: new Date().toISOString(),
    ...event,
  }
  db.audit.push(record)
  return record
}

export function findTarget(db: TargetDatabase, ref: string): TargetRecord {
  const target = db.targets.find((item) => item.id === ref || item.name === ref || item.locator === ref)
  if (!target) throw new Error(`Target not found: ${ref}`)
  return target
}

export function upsertTarget(db: TargetDatabase, next: TargetRecord) {
  const index = db.targets.findIndex((item) => item.id === next.id)
  if (index === -1) db.targets.push(next)
  else db.targets[index] = next
}
