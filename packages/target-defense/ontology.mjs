#!/usr/bin/env node

import { access, chmod, mkdir, readFile, stat, writeFile } from "node:fs/promises"
import { dirname, join } from "node:path"
import { spawnSync } from "node:child_process"
import os from "node:os"

const command = process.argv[2] ?? "summary"
const DB_PATH = process.env.TARGET_SHIELD_DB || ".cyberstrike/target-shield.json"
const GRAPH_PATH = process.env.TARGET_SHIELD_ONTOLOGY || ".cyberstrike/ontology.json"
const SCHEMA_PATH = new URL("./ontology.json", import.meta.url)
const PROTECTION_PATH = new URL("./data-protection.json", import.meta.url)
const USB_ROOT = process.env.GPT_DOUG_USB || "/Volumes/NO NAME"
const API_BASE = process.env.GPT_DOUG_API || "http://127.0.0.1:9931/v1"
const CYBERSTRIKE_HOME = process.env.CYBERSTRIKE_HOME || join(os.homedir(), ".local", "share", "cyberstrike")

async function exists(path) {
  try { await access(path); return true } catch { return false }
}

async function json(path, fallback) {
  try { return JSON.parse(await readFile(path, "utf8")) } catch { return fallback }
}

async function fetchModels() {
  try {
    const response = await fetch(`${API_BASE.replace(/\/$/, "")}/models`, { signal: AbortSignal.timeout(1500) })
    if (!response.ok) return []
    const body = await response.json()
    return Array.isArray(body?.data) ? body.data.map((x) => String(x?.id ?? "")).filter(Boolean) : []
  } catch { return [] }
}

function fileVaultState() {
  if (process.platform !== "darwin") return "unknown"
  const check = spawnSync("fdesetup", ["status"], { encoding: "utf8" })
  if (check.error || check.status !== 0) return "unknown"
  const text = `${check.stdout ?? ""} ${check.stderr ?? ""}`.toLowerCase()
  if (text.includes("filevault is on")) return "on"
  if (text.includes("filevault is off")) return "off"
  return "unknown"
}

function leaseId(target) { return `lease:${target.id}` }
function targetId(target) { return `target:${target.id}` }

function isLoopbackTransport(value, allowedHosts = []) {
  if (!value) return true
  try {
    const url = new URL(value)
    return allowedHosts.includes(url.hostname)
  } catch {
    return false
  }
}

function octalMode(mode) {
  return `0${(mode & 0o777).toString(8).padStart(3, "0")}`
}

async function permissionState(path) {
  try {
    const info = await stat(path)
    const privateMode = (info.mode & 0o077) === 0
    return { exists: true, mode: octalMode(info.mode), private: privateMode }
  } catch {
    return { exists: false, mode: null, private: null }
  }
}

async function secureStateFiles(protection) {
  await mkdir(dirname(DB_PATH), { recursive: true, mode: 0o700 })
  try { await chmod(dirname(DB_PATH), 0o700) } catch {}
  for (const asset of protection.dataAssets ?? []) {
    if (!asset.path || !asset.privatePermissionsRequired) continue
    if (await exists(asset.path)) await chmod(asset.path, 0o600)
  }
  if (await exists(GRAPH_PATH)) await chmod(GRAPH_PATH, 0o600)
}

async function buildGraph() {
  const shield = await json(DB_PATH, { targets: [], audit: [] })
  const cs = await json("cyberstrike.json", {})
  const protection = await json(PROTECTION_PATH, { policy: {}, dataAssets: [], approvedProcessors: [] })
  const models = await fetchModels()
  const objects = []
  const links = []

  const runtimeId = "runtime:gpt-doug-pocket"
  const providerId = "provider:gpt-doug-llm"
  const usbMounted = await exists(USB_ROOT)

  objects.push({
    objectType: "Runtime",
    id: runtimeId,
    kind: "usb-local-llm",
    location: USB_ROOT,
    status: usbMounted ? "mounted" : "missing",
    transport: API_BASE,
    metadata: { cyberstrikeHome: CYBERSTRIKE_HOME }
  })

  objects.push({
    objectType: "Provider",
    id: providerId,
    name: "GPT-DOUG-LLM",
    api: API_BASE,
    status: models.length ? "ready" : "offline",
    authType: "local",
    local: true
  })

  for (const id of models) {
    const modelId = `model:${id}`
    objects.push({ objectType: "Model", id: modelId, providerId, runtimeId, status: "ready", contextWindow: null, capabilities: ["chat", "tool-use"] })
    links.push({ linkType: "RUNS_ON", from: modelId, to: runtimeId })
    links.push({ linkType: "EXPOSED_BY", from: modelId, to: providerId })
  }

  for (const target of shield.targets ?? []) {
    const id = targetId(target)
    objects.push({ ...target, sourceId: target.id, objectType: "Target", id })
    if (target.authorization) {
      const lease = target.authorization
      const lid = leaseId(target)
      const now = Date.now()
      const active = now >= Date.parse(lease.validFrom) && now <= Date.parse(lease.validUntil)
      objects.push({ objectType: "AuthorizationLease", id: lid, targetId: id, owner: lease.owner, approvedBy: lease.approvedBy, scope: lease.scope, reason: lease.reason, validFrom: lease.validFrom, validUntil: lease.validUntil, status: active ? "active" : "expired" })
      links.push({ linkType: "AUTHORIZES", from: lid, to: id })
    }
  }

  for (const event of shield.audit ?? []) {
    const id = `audit:${event.id}`
    objects.push({ ...event, sourceId: event.id, objectType: "AuditEvent", id })
  }

  const policy = protection.policy ?? {}
  if (policy.id) {
    objects.push({ objectType: "DataProtectionPolicy", ...policy })
  }

  const processorById = new Map()
  for (const processor of protection.approvedProcessors ?? []) {
    const status = processor.id === "processor:gpt-doug-local" ? (models.length ? "ready" : "offline") : "ready"
    const object = { objectType: "Processor", ...processor, status }
    processorById.set(object.id, object)
    objects.push(object)
  }

  for (const asset of protection.dataAssets ?? []) {
    const permissions = asset.path ? await permissionState(asset.path) : { exists: null, mode: null, private: null }
    const object = {
      objectType: "DataAsset",
      ...asset,
      permissionState: permissions,
      encryptionState: asset.path ? fileVaultState() : "memory-only",
      status: asset.path ? (permissions.exists ? "present" : "not-present") : "transient"
    }
    objects.push(object)
    if (policy.id) links.push({ linkType: "PROTECTED_BY", from: object.id, to: policy.id })
  }

  const inferenceAsset = objects.find((o) => o.id === "data:local-inference-context")
  const localProcessor = processorById.get("processor:gpt-doug-local")
  if (inferenceAsset && localProcessor && policy.id) {
    const decision = localProcessor.local && localProcessor.classifications?.includes(inferenceAsset.classification) ? "ALLOW" : "DENY"
    const flowId = "flow:local-inference-to-gpt-doug"
    objects.push({
      objectType: "DataFlow",
      id: flowId,
      dataAssetId: inferenceAsset.id,
      processorId: localProcessor.id,
      purpose: inferenceAsset.purpose,
      decision,
      reason: decision === "ALLOW" ? "restricted context remains on approved loopback processor" : "processor does not satisfy local restricted-data policy",
      createdAt: new Date().toISOString()
    })
    links.push({ linkType: "FLOW_USES", from: flowId, to: inferenceAsset.id })
    links.push({ linkType: "FLOW_TO", from: flowId, to: localProcessor.id })
    links.push({ linkType: "FLOW_GOVERNED_BY", from: flowId, to: policy.id })
    links.push({ linkType: "PROCESSED_BY", from: inferenceAsset.id, to: localProcessor.id })
  }

  return {
    ontology: "xunia-target-shield",
    version: "1.1.0",
    generatedAt: new Date().toISOString(),
    defaultModel: cs.model ?? null,
    dataProtectionPolicy: policy.id ?? null,
    objects,
    links
  }
}

function normalize(value) {
  return String(value ?? "").trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/$/, "")
}

function matchesScope(locator, scope = []) {
  const candidate = normalize(locator)
  return scope.some((entry) => {
    const allowed = normalize(entry)
    return candidate === allowed || candidate.endsWith(`.${allowed}`) || candidate.startsWith(`${allowed}:`)
  })
}

function findForbiddenKeys(value, forbidden, path = "$", hits = []) {
  if (!value || typeof value !== "object") return hits
  if (Array.isArray(value)) {
    value.forEach((item, index) => findForbiddenKeys(item, forbidden, `${path}[${index}]`, hits))
    return hits
  }
  for (const [key, child] of Object.entries(value)) {
    if (forbidden.has(key) && child !== undefined && child !== null && String(child).length > 0) hits.push(`${path}.${key}`)
    findForbiddenKeys(child, forbidden, `${path}.${key}`, hits)
  }
  return hits
}

function validate(graph) {
  const errors = []
  const warnings = []
  const seen = new Set()

  for (const object of graph.objects) {
    if (!object?.id) { errors.push(`${object?.objectType ?? "Object"}: missing ontology id`); continue }
    if (seen.has(object.id)) errors.push(`${object.id}: duplicate ontology id`)
    seen.add(object.id)
  }

  const byId = new Map(graph.objects.map((o) => [o.id, o]))
  const leases = graph.objects.filter((o) => o.objectType === "AuthorizationLease")
  const policy = graph.objects.find((o) => o.objectType === "DataProtectionPolicy")
  const dataAssets = graph.objects.filter((o) => o.objectType === "DataAsset")
  const flows = graph.objects.filter((o) => o.objectType === "DataFlow")

  for (const lease of leases) {
    const target = byId.get(lease.targetId)
    if (!target) { errors.push(`${lease.id}: target missing`); continue }
    if (lease.owner !== target.owner) errors.push(`${lease.id}: owner mismatch`)
    const start = Date.parse(lease.validFrom)
    const end = Date.parse(lease.validUntil)
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) errors.push(`${lease.id}: invalid time window`)
    if (Number.isFinite(start) && Number.isFinite(end) && end - start > 168 * 3600000) errors.push(`${lease.id}: lease exceeds 168 hours`)
    if (!matchesScope(target.locator, lease.scope)) errors.push(`${lease.id}: target locator outside scope`)
  }

  for (const link of graph.links) {
    if (!byId.has(link.from)) errors.push(`${link.linkType}: source missing (${link.from})`)
    if (!byId.has(link.to)) errors.push(`${link.linkType}: destination missing (${link.to})`)
  }

  if (!policy) {
    errors.push("data protection policy missing")
  } else {
    const allowedClassifications = new Set(policy.allowedClassifications ?? [])
    const localOnly = new Set(policy.localProcessingOnlyFor ?? [])
    const allowedHosts = policy.allowedLocalTransports ?? []

    for (const asset of dataAssets) {
      if (!allowedClassifications.has(asset.classification)) errors.push(`${asset.id}: unsupported classification ${asset.classification}`)
      const protectedLink = graph.links.some((l) => l.linkType === "PROTECTED_BY" && l.from === asset.id && l.to === policy.id)
      if (!protectedLink) errors.push(`${asset.id}: not linked to data protection policy`)
      if (asset.egress !== "DENY" && ["CONFIDENTIAL", "RESTRICTED"].includes(asset.classification)) errors.push(`${asset.id}: sensitive data egress must default DENY`)
      if (asset.privatePermissionsRequired && asset.permissionState?.exists && !asset.permissionState.private) errors.push(`${asset.id}: state file permissions are not private (${asset.permissionState.mode})`)
      if (asset.encryptionRequired && asset.encryptionState === "off") errors.push(`${asset.id}: required host encryption is OFF`)
      if (asset.encryptionRequired && asset.encryptionState === "unknown") warnings.push(`${asset.id}: host encryption state could not be verified`)

      if (localOnly.has(asset.classification)) {
        for (const link of graph.links.filter((l) => l.linkType === "PROCESSED_BY" && l.from === asset.id)) {
          const processor = byId.get(link.to)
          if (!processor?.local) errors.push(`${asset.id}: ${asset.classification} data assigned to non-local processor ${link.to}`)
          if (processor?.transport && !isLoopbackTransport(processor.transport, allowedHosts)) errors.push(`${asset.id}: processor transport is not approved loopback (${processor.transport})`)
        }
      }
    }

    for (const flow of flows) {
      const asset = byId.get(flow.dataAssetId)
      const processor = byId.get(flow.processorId)
      if (!asset) errors.push(`${flow.id}: protected data asset missing`)
      if (!processor) errors.push(`${flow.id}: processor missing`)
      if (!flow.purpose) errors.push(`${flow.id}: purpose missing`)
      if (flow.decision !== "ALLOW") errors.push(`${flow.id}: data flow denied by ontology (${flow.reason ?? "no reason"})`)
      if (asset && processor && localOnly.has(asset.classification)) {
        if (!processor.local) errors.push(`${flow.id}: ${asset.classification} data cannot leave local processors`)
        if (processor.transport && !isLoopbackTransport(processor.transport, allowedHosts)) errors.push(`${flow.id}: non-loopback sensitive-data transport ${processor.transport}`)
      }
    }

    const forbidden = new Set(policy.forbiddenGraphKeys ?? [])
    const secretHits = findForbiddenKeys(graph, forbidden)
    for (const hit of secretHits) errors.push(`DLP: forbidden secret-bearing field serialized at ${hit}`)
  }

  const provider = byId.get("provider:gpt-doug-llm")
  const runtime = byId.get("runtime:gpt-doug-pocket")
  if (runtime?.status !== "mounted") warnings.push("GPT-DOUG POCKET USB is not mounted")
  if (provider?.status !== "ready") warnings.push("GPT-DOUG local provider is offline or exposes no models")
  if (!graph.defaultModel?.startsWith("gpt-doug-llm/")) warnings.push("CyberStrike default model is not bound to gpt-doug-llm")

  return { valid: errors.length === 0, errors, warnings, dataProtection: errors.filter((x) => x.startsWith("data:") || x.startsWith("flow:") || x.startsWith("DLP:") || x.includes("data protection")).length === 0 ? "ENFORCED" : "NO-GO" }
}

async function main() {
  if (command === "schema") {
    console.log(await readFile(SCHEMA_PATH, "utf8"))
    return
  }

  const protection = await json(PROTECTION_PATH, { dataAssets: [] })
  if (command === "sync") await secureStateFiles(protection)

  const graph = await buildGraph()
  const result = validate(graph)

  if (command === "sync") {
    await mkdir(dirname(GRAPH_PATH), { recursive: true, mode: 0o700 })
    await writeFile(GRAPH_PATH, `${JSON.stringify(graph, null, 2)}\n`, { encoding: "utf8", mode: 0o600 })
    await chmod(GRAPH_PATH, 0o600)
    console.log(`✅ ontology synced → ${GRAPH_PATH}`)
    console.log(`🔐 data protection: ${result.dataProtection}`)
    console.log(JSON.stringify(result, null, 2))
    if (!result.valid) process.exitCode = 2
    return
  }

  if (command === "validate") {
    console.log(JSON.stringify(result, null, 2))
    if (!result.valid) process.exitCode = 2
    return
  }

  if (command === "graph") {
    console.log(JSON.stringify(graph, null, 2))
    return
  }

  const counts = {}
  for (const object of graph.objects) counts[object.objectType] = (counts[object.objectType] ?? 0) + 1
  console.log(JSON.stringify({ ontology: graph.ontology, version: graph.version, defaultModel: graph.defaultModel, dataProtectionPolicy: graph.dataProtectionPolicy, counts, links: graph.links.length, validation: result }, null, 2))
}

main().catch((error) => {
  console.error(`❌ ${error instanceof Error ? error.message : String(error)}`)
  process.exitCode = 1
})
