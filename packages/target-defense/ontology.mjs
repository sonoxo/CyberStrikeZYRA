#!/usr/bin/env node

import { access, mkdir, readFile, writeFile } from "node:fs/promises"
import { dirname, join } from "node:path"
import os from "node:os"

const command = process.argv[2] ?? "summary"
const DB_PATH = process.env.TARGET_SHIELD_DB || ".cyberstrike/target-shield.json"
const GRAPH_PATH = process.env.TARGET_SHIELD_ONTOLOGY || ".cyberstrike/ontology.json"
const SCHEMA_PATH = new URL("./ontology.json", import.meta.url)
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

function leaseId(target) { return `lease:${target.id}` }
function targetId(target) { return `target:${target.id}` }

async function buildGraph() {
  const shield = await json(DB_PATH, { targets: [], audit: [] })
  const cs = await json("cyberstrike.json", {})
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
    objects.push({
      objectType: "Model",
      id: modelId,
      providerId,
      runtimeId,
      status: "ready",
      contextWindow: null,
      capabilities: ["chat", "tool-use"]
    })
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
      objects.push({
        objectType: "AuthorizationLease",
        id: lid,
        targetId: id,
        owner: lease.owner,
        approvedBy: lease.approvedBy,
        scope: lease.scope,
        reason: lease.reason,
        validFrom: lease.validFrom,
        validUntil: lease.validUntil,
        status: active ? "active" : "expired"
      })
      links.push({ linkType: "AUTHORIZES", from: lid, to: id })
    }
  }

  for (const event of shield.audit ?? []) {
    const id = `audit:${event.id}`
    objects.push({ ...event, sourceId: event.id, objectType: "AuditEvent", id })
  }

  return {
    ontology: "xunia-target-shield",
    version: "1.0.1",
    generatedAt: new Date().toISOString(),
    defaultModel: cs.model ?? null,
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

function validate(graph) {
  const errors = []
  const warnings = []
  const seen = new Set()
  for (const object of graph.objects) {
    if (!object?.id) {
      errors.push(`${object?.objectType ?? "Object"}: missing ontology id`)
      continue
    }
    if (seen.has(object.id)) errors.push(`${object.id}: duplicate ontology id`)
    seen.add(object.id)
  }

  const byId = new Map(graph.objects.map((o) => [o.id, o]))
  const leases = graph.objects.filter((o) => o.objectType === "AuthorizationLease")

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

  const provider = byId.get("provider:gpt-doug-llm")
  const runtime = byId.get("runtime:gpt-doug-pocket")
  if (runtime?.status !== "mounted") warnings.push("GPT-DOUG POCKET USB is not mounted")
  if (provider?.status !== "ready") warnings.push("GPT-DOUG local provider is offline or exposes no models")
  if (!graph.defaultModel?.startsWith("gpt-doug-llm/")) warnings.push("CyberStrike default model is not bound to gpt-doug-llm")

  return { valid: errors.length === 0, errors, warnings }
}

async function main() {
  if (command === "schema") {
    console.log(await readFile(SCHEMA_PATH, "utf8"))
    return
  }

  const graph = await buildGraph()
  const result = validate(graph)

  if (command === "sync") {
    await mkdir(dirname(GRAPH_PATH), { recursive: true })
    await writeFile(GRAPH_PATH, `${JSON.stringify(graph, null, 2)}\n`, "utf8")
    console.log(`✅ ontology synced → ${GRAPH_PATH}`)
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
  console.log(JSON.stringify({
    ontology: graph.ontology,
    version: graph.version,
    defaultModel: graph.defaultModel,
    counts,
    links: graph.links.length,
    validation: result
  }, null, 2))
}

main().catch((error) => {
  console.error(`❌ ${error instanceof Error ? error.message : String(error)}`)
  process.exitCode = 1
})
