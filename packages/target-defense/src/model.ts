export type TargetKind = "host" | "domain" | "service" | "repository" | "indicator"

export type TargetStatus = "observed" | "authorized" | "contained" | "recovered" | "closed"

export type ResponseAction =
  | "observe"
  | "block"
  | "isolate"
  | "sinkhole_internal"
  | "rotate_credentials"
  | "disable_service"
  | "preserve_evidence"
  | "restore"

export interface AuthorizationLease {
  owner: string
  approvedBy: string
  scope: string[]
  reason: string
  validFrom: string
  validUntil: string
}

export interface TargetRecord {
  id: string
  name: string
  kind: TargetKind
  locator: string
  owner: string
  environment: "local" | "lab" | "dev" | "staging" | "production"
  criticality: 1 | 2 | 3 | 4 | 5
  exposure: 1 | 2 | 3 | 4 | 5
  confidence: 1 | 2 | 3 | 4 | 5
  impact: 1 | 2 | 3 | 4 | 5
  status: TargetStatus
  authorization?: AuthorizationLease
  tags: string[]
  notes?: string
  createdAt: string
  updatedAt: string
}

export interface AuditEvent {
  id: string
  timestamp: string
  targetId?: string
  action: string
  actor: string
  decision: "ALLOW" | "DENY" | "INFO"
  reason: string
}

export interface TargetDatabase {
  version: 1
  targets: TargetRecord[]
  audit: AuditEvent[]
}

export interface Decision {
  allowed: boolean
  reason: string
  score?: number
  tier?: "P1" | "P2" | "P3" | "P4"
}

export interface ResponsePlan {
  targetId: string
  priority: "P1" | "P2" | "P3" | "P4"
  actions: ResponseAction[]
  rationale: string[]
}
