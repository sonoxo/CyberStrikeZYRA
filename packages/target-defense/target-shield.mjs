#!/usr/bin/env node

import { mkdir, readFile, writeFile, access } from "node:fs/promises"
import { dirname, join } from "node:path"
import { randomUUID } from "node:crypto"
import { spawnSync } from "node:child_process"
import { createConnection } from "node:net"
import os from "node:os"

const DEFAULT_DB = ".cyberstrike/target-shield.json"
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

const argv = process.argv.slice(2)
const command = argv.shift() ?? "help"

function flag(name, fallback) {
  const i = argv.indexOf(`--${name}`)
  if (i === -1) return fallback
  return argv[i + 1]
}

function hasFlag(name) {
  return argv.includes(`--${name}`)
}

function required(name) {
  const value = flag(name)
  if (!value) throw new Error(`Missing --${name}`)
  return value
}

function intFlag(name, fallback) {
  const value = Number.parseInt(flag(name, String(fallback)), 10)
  if (!Number.isInteger(value) || value < 1 || value > 5) throw new Error(`--${name} must be an integer from 1 to 5`)
  return value
}

function targetRef() {
  const flagsWithValues = new Set(["db", "approved-by", "reason", "scope", "hours", "action", "name", "kind", "locator", "owner", "env", "criticality", "exposure", "confidence", "impact", "tags", "notes"])
  for (let i = 0; i < argv.length; i++) {
    const item = argv[i]
    if (item.startsWith("--")) {
      if (flagsWithValues.has(item.slice(2))) i++
      continue
    }
    return item
  }
  throw new Error("Missing target id/name/locator")
}

function print(value) {
  console.log(typeof value === "string" ? value : JSON.stringify(value, null, 2))
}

async function loadDb(path = DEFAULT_DB) {
  try {
    const parsed = JSON.parse(await readFile(path, "utf8"))
    if (parsed.version !== 1 || !Array.isArray(parsed.targets) || !Array.isArray(parsed.audit)) {
      throw new Error(`Unsupported or corrupt Target Shield database: ${path}`)
    }
    return parsed
  } catch (error) {
    if (error?.code === "ENOENT") return { version: 1, targets: [], audit: [] }
    throw error
  }
}

async function saveDb(db, path = DEFAULT_DB) {
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, `${JSON.stringify(db, null, 2)}\n`, "utf8")
}

function appendAudit(db, event) {
  const record = { id: randomUUID(), timestamp: new Date().toISOString(), ...event }
  db.audit.push(record)
  return record
}

function findTarget(db, ref) {
  const target = db.targets.find((item) => item.id === ref || item.name === ref || item.locator === ref)
  if (!target) throw new Error(`Target not found: ${ref}`)
  return target
}

const normalize = (value) => value.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/$/, "")

function scopeMatches(locator, scope) {
  const candidate = normalize(locator)
  return scope.some((entry) => {
    const allowed = normalize(entry)
    return candidate === allowed || candidate.endsWith(`.${allowed}`) || candidate.startsWith(`${allowed}:`)
  })
}

function priority(target) {
  const raw = target.criticality * 0.3 + target.exposure * 0.25 + target.confidence * 0.2 + target.impact * 0.25
  const score = Math.round((raw / 5) * 100)
  const tier = score >= 80 ? "P1" : score >= 60 ? "P2" : score >= 35 ? "P3" : "P4"
  return { allowed: true, reason: `priority ${tier}`, score, tier }
}

function authorizeAction(target, action, now = new Date()) {
  if (!ACTIVE_ACTIONS.has(action)) return { allowed: true, reason: "passive/read-only action" }
  const lease = target.authorization
  if (!lease) return { allowed: false, reason: "NO-GO: no authorization lease" }
  const starts = new Date(lease.validFrom)
  const ends = new Date(lease.validUntil)
  if (Number.isNaN(starts.getTime()) || Number.isNaN(ends.getTime())) return { allowed: false, reason: "NO-GO: invalid authorization timestamps" }
  if (now < starts || now > ends) return { allowed: false, reason: "NO-GO: authorization lease is not active" }
  if (lease.owner !== target.owner) return { allowed: false, reason: "NO-GO: lease owner does not match target owner" }
  if (!scopeMatches(target.locator, lease.scope)) return { allowed: false, reason: "NO-GO: target locator is outside approved scope" }
  return { allowed: true, reason: `GO: authorized by ${lease.approvedBy} for ${lease.reason}` }
}

function buildResponsePlan(target) {
  const p = priority(target)
  const actions = ["preserve_evidence", "observe"]
  const rationale = [`Target scored ${p.score}/100 (${p.tier}).`]
  if (p.tier === "P1") {
    actions.push("isolate", "block", "rotate_credentials")
    rationale.push("High-confidence/high-impact condition: prioritize containment and credential hygiene.")
  } else if (p.tier === "P2") {
    actions.push("block", "rotate_credentials")
    rationale.push("Material risk: reduce reachable attack surface and rotate exposed credentials.")
  } else if (p.tier === "P3") {
    actions.push("block")
    rationale.push("Moderate risk: block confirmed malicious indicators while validating telemetry.")
  } else {
    rationale.push("Low current risk: continue observation and evidence collection.")
  }
  if (target.environment === "local" || target.environment === "lab") {
    actions.push("sinkhole_internal")
    rationale.push("Internal/lab scope permits defensive sinkholing without contacting third-party systems.")
  }
  return { targetId: target.id, priority: p.tier, actions: [...new Set(actions)], rationale }
}

function authorizedScope(target) {
  const decision = authorizeAction(target, "scan")
  if (!decision.allowed) throw new Error(decision.reason)
  return { locator: target.locator, scope: [...target.authorization.scope], decision }
}

function webTarget(target) {
  if (!["host", "domain", "service"].includes(target.kind)) {
    throw new Error(`Target kind ${target.kind} is not a web-launch target`)
  }
  if (/^https?:\/\//i.test(target.locator)) return target.locator
  const local = /^(localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/i.test(target.locator)
  return `${local ? "http" : "https"}://${target.locator}`
}

function cyberStrikeHome() {
  return process.env.CYBERSTRIKE_HOME || join(os.homedir(), ".local", "share", "cyberstrike")
}

async function pathExists(path) {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

async function playwrightReady() {
  const home = cyberStrikeHome()
  const packageReady = await pathExists(join(home, "node_modules", "playwright", "package.json"))
  return { home, packageReady }
}

function cyberStrikeReady() {
  const probe = spawnSync("cyberstrike", ["--version"], { stdio: "ignore" })
  return !probe.error && probe.status === 0
}

async function localEndpointReady(urlString, timeoutMs = 2000) {
  const url = new URL(urlString)
  const isLocal = ["localhost", "127.0.0.1", "::1", "[::1]"].includes(url.hostname)
  if (!isLocal) return { checked: false, ready: true, reason: "non-local endpoint not socket-preflighted" }
  const port = Number(url.port || (url.protocol === "https:" ? 443 : 80))
  const host = url.hostname.replace(/^\[|\]$/g, "")
  return await new Promise((resolve) => {
    const socket = createConnection({ host, port })
    const timer = setTimeout(() => {
      socket.destroy()
      resolve({ checked: true, ready: false, reason: `${host}:${port} did not accept a connection within ${timeoutMs}ms` })
    }, timeoutMs)
    socket.once("connect", () => {
      clearTimeout(timer)
      socket.destroy()
      resolve({ checked: true, ready: true, reason: `${host}:${port} is listening` })
    })
    socket.once("error", (error) => {
      clearTimeout(timer)
      resolve({ checked: true, ready: false, reason: `${host}:${port} is not listening (${error.code ?? error.message})` })
    })
  })
}

async function doctor({ fixBrowser = false } = {}) {
  const cliReady = cyberStrikeReady()
  let browser = await playwrightReady()
  const result = {
    cyberstrike: cliReady ? "READY" : "MISSING",
    cyberstrikeHome: browser.home,
    playwright: browser.packageReady ? "READY" : "MISSING",
  }

  print(result)

  if (!cliReady) {
    console.log("FIX: npm install -g @cyberstrike-io/cyberstrike@latest")
  }

  if (!browser.packageReady && fixBrowser) {
    console.log(`🔧 installing Playwright into ${browser.home}`)
    const installPackage = spawnSync("npm", ["install", "--prefix", browser.home, "playwright"], { stdio: "inherit" })
    if (installPackage.status !== 0) throw new Error("Playwright package installation failed")
    const installBrowser = spawnSync("npm", ["exec", "--prefix", browser.home, "playwright", "--", "install", "chromium"], { stdio: "inherit" })
    if (installBrowser.status !== 0) throw new Error("Chromium installation failed")
    browser = await playwrightReady()
    console.log(browser.packageReady ? "✅ Playwright package installed" : "❌ Playwright package still missing")
  } else if (!browser.packageReady) {
    console.log(`FIX: npm install --prefix ${JSON.stringify(browser.home)} playwright`)
    console.log(`THEN: npm exec --prefix ${JSON.stringify(browser.home)} playwright -- install chromium`)
    console.log("OR: rerun doctor with --fix-browser")
  }

  return cliReady && browser.packageReady
}

async function main() {
  if (command === "help") {
    print(`CyberStrike Target Shield\n\nCommands:\n  init\n  add --name NAME --kind host|domain|service|repository|indicator --locator VALUE --owner OWNER [--env lab]\n  authorize TARGET --approved-by NAME --reason TEXT --scope comma,separated,scope [--hours 8]\n  check TARGET --action ACTION\n  score TARGET\n  plan TARGET\n  scope TARGET\n  doctor [--fix-browser]\n  launch TARGET        # authorized local/lab web target only\n  list\n  audit\n\nActive actions are NO-GO unless the target has a current authorization lease and its locator matches the approved scope. Launch also fails closed when CyberStrike/Playwright are unavailable or a local target is not listening.`)
    return
  }

  if (command === "doctor") {
    const ok = await doctor({ fixBrowser: hasFlag("fix-browser") })
    if (!ok) process.exitCode = 2
    return
  }

  const path = flag("db", DEFAULT_DB)
  const db = await loadDb(path)

  if (command === "init") {
    appendAudit(db, { actor: "target-shield", action: "init", decision: "INFO", reason: "Target Shield database initialized" })
    await saveDb(db, path)
    print(`✅ initialized ${path}`)
    return
  }

  if (command === "add") {
    const kind = required("kind")
    if (!["host", "domain", "service", "repository", "indicator"].includes(kind)) throw new Error("Unsupported --kind")
    const environment = flag("env", "lab")
    if (!["local", "lab", "dev", "staging", "production"].includes(environment)) throw new Error("Unsupported --env")
    const now = new Date().toISOString()
    const target = {
      id: randomUUID(), name: required("name"), kind, locator: required("locator"), owner: required("owner"), environment,
      criticality: intFlag("criticality", 3), exposure: intFlag("exposure", 3), confidence: intFlag("confidence", 3), impact: intFlag("impact", 3),
      status: "observed", tags: (flag("tags", "") || "").split(",").map((v) => v.trim()).filter(Boolean), notes: flag("notes"), createdAt: now, updatedAt: now,
    }
    db.targets.push(target)
    appendAudit(db, { targetId: target.id, actor: "operator", action: "add_target", decision: "INFO", reason: `Registered ${target.locator} as observed target` })
    await saveDb(db, path)
    print(target)
    return
  }

  if (command === "authorize") {
    const target = findTarget(db, targetRef())
    const scope = required("scope").split(",").map((v) => v.trim()).filter(Boolean)
    if (!scope.length) throw new Error("Authorization scope cannot be empty")
    const hours = Number.parseFloat(flag("hours", "8"))
    if (!Number.isFinite(hours) || hours <= 0 || hours > 168) throw new Error("--hours must be > 0 and <= 168")
    const validFrom = new Date()
    const validUntil = new Date(validFrom.getTime() + hours * 3600000)
    target.authorization = { owner: target.owner, approvedBy: required("approved-by"), scope, reason: required("reason"), validFrom: validFrom.toISOString(), validUntil: validUntil.toISOString() }
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

  if (command === "score") return print(priority(findTarget(db, targetRef())))

  if (command === "plan") {
    const target = findTarget(db, targetRef())
    const plan = buildResponsePlan(target)
    appendAudit(db, { targetId: target.id, actor: "target-shield", action: "build_response_plan", decision: "INFO", reason: `Generated ${plan.priority} defensive response plan` })
    await saveDb(db, path)
    return print(plan)
  }

  if (command === "scope") {
    const target = findTarget(db, targetRef())
    const result = authorizedScope(target)
    appendAudit(db, { targetId: target.id, actor: "operator", action: "export_authorized_scope", decision: "ALLOW", reason: "Exported Target Shield authorization scope" })
    await saveDb(db, path)
    return print({ target: target.name, locator: result.locator, authorizedScope: result.scope, decision: result.decision })
  }

  if (command === "launch") {
    const target = findTarget(db, targetRef())
    const result = authorizedScope(target)
    if (!["local", "lab"].includes(target.environment)) {
      throw new Error("NO-GO: automatic CyberStrike launch is restricted to local/lab targets")
    }
    const url = webTarget(target)
    const endpoint = await localEndpointReady(url)
    if (!endpoint.ready) {
      appendAudit(db, { targetId: target.id, actor: "target-shield", action: "launch_preflight", decision: "DENY", reason: `NO-GO: ${endpoint.reason}` })
      await saveDb(db, path)
      throw new Error(`NO-GO: target is not ready: ${endpoint.reason}`)
    }
    const depsReady = await doctor({ fixBrowser: false })
    if (!depsReady) {
      appendAudit(db, { targetId: target.id, actor: "target-shield", action: "launch_preflight", decision: "DENY", reason: "NO-GO: CyberStrike browser runtime is incomplete" })
      await saveDb(db, path)
      throw new Error("NO-GO: CyberStrike browser runtime is incomplete; run 'node packages/target-defense/target-shield.mjs doctor --fix-browser'")
    }
    appendAudit(db, { targetId: target.id, actor: "operator", action: "launch_cyberstrike_hackbrowser", decision: "ALLOW", reason: `${result.decision.reason}; ${endpoint.reason}; launching ${url}` })
    await saveDb(db, path)
    console.log(`✅ GO: launching CyberStrike HackBrowser for ${url}`)
    const child = spawnSync("cyberstrike", ["hackbrowser", url], { stdio: "inherit" })
    if (child.error?.code === "ENOENT") throw new Error("cyberstrike command not found in PATH")
    if (child.error) throw child.error
    if (typeof child.status === "number" && child.status !== 0) process.exitCode = child.status
    return
  }

  if (command === "list") return print(db.targets.map((target) => ({ id: target.id, name: target.name, kind: target.kind, locator: target.locator, owner: target.owner, status: target.status, priority: priority(target).tier })))
  if (command === "audit") return print(db.audit)
  throw new Error(`Unknown command: ${command}`)
}

main().catch((error) => {
  console.error(`❌ ${error instanceof Error ? error.message : String(error)}`)
  process.exitCode = 1
})
