import type { TargetKind, TargetRecord } from "./model.ts"
import { authorizeAction, buildResponsePlan, cyberStrikeScopeArgs, priority } from "./policy.ts"
import { appendAudit, DEFAULT_DB, findTarget, loadDb, saveDb, upsertTarget } from "./store.ts"

const args = process.argv.slice(2)
const command = args.shift() ?? "help"

function flag(name: string, fallback?: string) {
  const index = args.indexOf(`--${name}`)
  if (index === -1) return fallback
  return args[index + 1]
}

function required(name: string) {
  const value = flag(name)
  if (!value) throw new Error(`Missing --${name}`)
  return value
}

function intFlag(name: string, fallback: number) {
  const raw = flag(name, String(fallback))!
  const value = Number.parseInt(raw, 10)
  if (!Number.isInteger(value) || value < 1 || value > 5) throw new Error(`--${name} must be an integer from 1 to 5`)
  return value as 1 | 2 | 3 | 4 | 5
}

function dbPath() {
  return flag("db", DEFAULT_DB)!
}

function targetRef() {
  const value = args.find((arg) => !arg.startsWith("--") && arg !== flag("db"))
  if (!value) throw new Error("Missing target id/name/locator")
  return value
}

function print(value: unknown) {
  console.log(typeof value === "string" ? value : JSON.stringify(value, null, 2))
}

async function main() {
  if (command === "help") {
    print(`CyberStrike Target Shield\n\nCommands:\n  init\n  add --name NAME --kind host|domain|service|repository|indicator --locator VALUE --owner OWNER [--env lab] [--criticality 3 --exposure 3 --confidence 3 --impact 3]\n  authorize TARGET --approved-by NAME --reason TEXT --scope comma,separated,scope [--hours 8]\n  check TARGET --action ACTION\n  score TARGET\n  plan TARGET\n  scope TARGET\n  list\n  audit\n\nActive actions are NO-GO unless the target has a current authorization lease and its locator matches the approved scope.`)
    return
  }

  const path = dbPath()
  const db = await loadDb(path)

  if (command === "init") {
    appendAudit(db, { actor: "target-shield", action: "init", decision: "INFO", reason: "Target Shield database initialized" })
    await saveDb(db, path)
    print(`✅ initialized ${path}`)
    return
  }

  if (command === "add") {
    const kind = required("kind") as TargetKind
    if (!["host", "domain", "service", "repository", "indicator"].includes(kind)) throw new Error("Unsupported --kind")
    const environment = (flag("env", "lab") ?? "lab") as TargetRecord["environment"]
    if (!["local", "lab", "dev", "staging", "production"].includes(environment)) throw new Error("Unsupported --env")
    const now = new Date().toISOString()
    const target: TargetRecord = {
      id: crypto.randomUUID(),
      name: required("name"),
      kind,
      locator: required("locator"),
      owner: required("owner"),
      environment,
      criticality: intFlag("criticality", 3),
      exposure: intFlag("exposure", 3),
      confidence: intFlag("confidence", 3),
      impact: intFlag("impact", 3),
      status: "observed",
      tags: (flag("tags", "") ?? "").split(",").map((v) => v.trim()).filter(Boolean),
      notes: flag("notes"),
      createdAt: now,
      updatedAt: now,
    }
    upsertTarget(db, target)
    appendAudit(db, { targetId: target.id, actor: "operator", action: "add_target", decision: "INFO", reason: `Registered ${target.locator} as observed target` })
    await saveDb(db, path)
    print(target)
    return
  }

  if (command === "authorize") {
    const target = findTarget(db, targetRef())
    const scope = required("scope").split(",").map((v) => v.trim()).filter(Boolean)
    if (!scope.length) throw new Error("Authorization scope cannot be empty")
    const hours = Number.parseFloat(flag("hours", "8")!)
    if (!Number.isFinite(hours) || hours <= 0 || hours > 168) throw new Error("--hours must be > 0 and <= 168")
    const validFrom = new Date()
    const validUntil = new Date(validFrom.getTime() + hours * 60 * 60 * 1000)
    target.authorization = {
      owner: target.owner,
      approvedBy: required("approved-by"),
      scope,
      reason: required("reason"),
      validFrom: validFrom.toISOString(),
      validUntil: validUntil.toISOString(),
    }
    target.status = "authorized"
    target.updatedAt = new Date().toISOString()
    const decision = authorizeAction(target, "scan")
    appendAudit(db, { targetId: target.id, actor: target.authorization.approvedBy, action: "authorize", decision: decision.allowed ? "ALLOW" : "DENY", reason: decision.reason })
    await saveDb(db, path)
    print({ target: target.name, authorization: target.authorization, decision })
    return
  }

  if (command === "check") {
    const target = findTarget(db, targetRef())
    const action = required("action")
    const decision = authorizeAction(target, action)
    appendAudit(db, { targetId: target.id, actor: "operator", action, decision: decision.allowed ? "ALLOW" : "DENY", reason: decision.reason })
    await saveDb(db, path)
    print(decision)
    if (!decision.allowed) process.exitCode = 2
    return
  }

  if (command === "score") {
    print(priority(findTarget(db, targetRef())))
    return
  }

  if (command === "plan") {
    const target = findTarget(db, targetRef())
    const plan = buildResponsePlan(target)
    appendAudit(db, { targetId: target.id, actor: "target-shield", action: "build_response_plan", decision: "INFO", reason: `Generated ${plan.priority} defensive response plan` })
    await saveDb(db, path)
    print(plan)
    return
  }

  if (command === "scope") {
    const target = findTarget(db, targetRef())
    const scopeArgs = cyberStrikeScopeArgs(target)
    appendAudit(db, { targetId: target.id, actor: "operator", action: "export_cyberstrike_scope", decision: "ALLOW", reason: "Exported authorization-constrained CyberStrike scope" })
    await saveDb(db, path)
    print({ target: target.name, args: scopeArgs, shell: `cyberstrike ${scopeArgs.map((v) => JSON.stringify(v)).join(" ")}` })
    return
  }

  if (command === "list") {
    print(db.targets.map((target) => ({ id: target.id, name: target.name, kind: target.kind, locator: target.locator, owner: target.owner, status: target.status, priority: priority(target).tier })))
    return
  }

  if (command === "audit") {
    print(db.audit)
    return
  }

  throw new Error(`Unknown command: ${command}`)
}

main().catch((error) => {
  console.error(`❌ ${error instanceof Error ? error.message : String(error)}`)
  process.exitCode = 1
})
