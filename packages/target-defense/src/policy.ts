import type { Decision, ResponsePlan, TargetRecord } from "./model.ts"

const ACTIVE_ACTIONS = new Set([
  "active_validate",
  "scan",
  "probe",
  "contain",
  "isolate",
  "block",
  "rotate_credentials",
  "disable_service",
  "restore",
])

const normalize = (value: string) => value.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/$/, "")

function scopeMatches(locator: string, scope: string[]) {
  const candidate = normalize(locator)
  return scope.some((entry) => {
    const allowed = normalize(entry)
    return candidate === allowed || candidate.endsWith(`.${allowed}`) || candidate.startsWith(`${allowed}:`)
  })
}

export function priority(target: TargetRecord): Decision {
  const raw =
    target.criticality * 0.3 +
    target.exposure * 0.25 +
    target.confidence * 0.2 +
    target.impact * 0.25
  const score = Math.round((raw / 5) * 100)
  const tier = score >= 80 ? "P1" : score >= 60 ? "P2" : score >= 35 ? "P3" : "P4"
  return { allowed: true, reason: `priority ${tier}`, score, tier }
}

export function authorizeAction(target: TargetRecord, action: string, now = new Date()): Decision {
  if (!ACTIVE_ACTIONS.has(action)) return { allowed: true, reason: "passive/read-only action" }

  const lease = target.authorization
  if (!lease) return { allowed: false, reason: "NO-GO: no authorization lease" }

  const starts = new Date(lease.validFrom)
  const ends = new Date(lease.validUntil)
  if (Number.isNaN(starts.getTime()) || Number.isNaN(ends.getTime())) {
    return { allowed: false, reason: "NO-GO: invalid authorization timestamps" }
  }
  if (now < starts || now > ends) return { allowed: false, reason: "NO-GO: authorization lease is not active" }
  if (lease.owner !== target.owner) return { allowed: false, reason: "NO-GO: lease owner does not match target owner" }
  if (!scopeMatches(target.locator, lease.scope)) return { allowed: false, reason: "NO-GO: target locator is outside approved scope" }

  return { allowed: true, reason: `GO: authorized by ${lease.approvedBy} for ${lease.reason}` }
}

export function buildResponsePlan(target: TargetRecord): ResponsePlan {
  const p = priority(target)
  const tier = p.tier ?? "P4"
  const actions: ResponsePlan["actions"] = ["preserve_evidence", "observe"]
  const rationale = [`Target scored ${p.score}/100 (${tier}).`]

  if (tier === "P1") {
    actions.push("isolate", "block", "rotate_credentials")
    rationale.push("High-confidence/high-impact condition: prioritize containment and credential hygiene.")
  } else if (tier === "P2") {
    actions.push("block", "rotate_credentials")
    rationale.push("Material risk: reduce reachable attack surface and rotate exposed credentials.")
  } else if (tier === "P3") {
    actions.push("block")
    rationale.push("Moderate risk: block confirmed malicious indicators while validating telemetry.")
  } else {
    rationale.push("Low current risk: continue observation and evidence collection.")
  }

  if (target.environment === "local" || target.environment === "lab") {
    actions.push("sinkhole_internal")
    rationale.push("Internal/lab scope permits defensive sinkholing without contacting third-party systems.")
  }

  return { targetId: target.id, priority: tier, actions: [...new Set(actions)], rationale }
}

export function cyberStrikeScopeArgs(target: TargetRecord) {
  const decision = authorizeAction(target, "scan")
  if (!decision.allowed) throw new Error(decision.reason)
  return target.authorization!.scope.flatMap((entry) => ["--scope", entry])
}
