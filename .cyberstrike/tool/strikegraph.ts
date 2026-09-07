/// <reference path="../env.d.ts" />
import { tool } from "@cyberstrike-io/plugin"
import { mkdir, readFile, rename, writeFile } from "node:fs/promises"
import { dirname, resolve, sep } from "node:path"

const DEFAULT_PATH = ".cyberstrike/ontology/strikegraph.json"
const PROPERTY_TYPES = new Set(["string", "number", "boolean", "string[]", "number[]", "json"])
const SAFE_ACTION_MODES = new Set(["recommend", "simulate", "approved"])

type PropertyType = "string" | "number" | "boolean" | "string[]" | "number[]" | "json"
type EntityType = { required?: string[]; properties?: Record<string, PropertyType> }
type RelationType = { from: string[]; to: string[] }
type Entity = { id: string; type: string; properties: Record<string, unknown> }
type Relation = { id: string; type: string; from: string; to: string; properties?: Record<string, unknown> }
type StrikeGraph = {
  version: 1
  metadata?: Record<string, unknown>
  schema: { entityTypes: Record<string, EntityType>; relationTypes: Record<string, RelationType> }
  entities: Entity[]
  relations: Relation[]
}

type Validation = { valid: boolean; errors: string[]; warnings: string[] }

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value)
}

function clamp(value: number, min = 0, max = 1) {
  return Math.min(max, Math.max(min, value))
}

function graphPath(context: { worktree: string }, input?: string) {
  const root = resolve(context.worktree)
  const candidate = resolve(root, input?.trim() || DEFAULT_PATH)
  if (candidate === root || !candidate.startsWith(`${root}${sep}`)) {
    throw new Error("StrikeGraph path must stay inside the current repository")
  }
  return candidate
}

async function loadGraph(context: { worktree: string }, input?: string): Promise<StrikeGraph> {
  const path = graphPath(context, input)
  const raw = await readFile(path, "utf8")
  return JSON.parse(raw) as StrikeGraph
}

async function saveGraph(context: { worktree: string }, graph: StrikeGraph, input?: string) {
  const path = graphPath(context, input)
  await mkdir(dirname(path), { recursive: true })
  const temp = `${path}.tmp-${process.pid}-${Date.now()}`
  await writeFile(temp, `${JSON.stringify(graph, null, 2)}\n`, "utf8")
  await rename(temp, path)
  return path
}

function valueMatches(value: unknown, type: PropertyType) {
  if (type === "json") return true
  if (type === "string") return typeof value === "string"
  if (type === "number") return typeof value === "number" && Number.isFinite(value)
  if (type === "boolean") return typeof value === "boolean"
  if (type === "string[]") return Array.isArray(value) && value.every((entry) => typeof entry === "string")
  if (type === "number[]") return Array.isArray(value) && value.every((entry) => typeof entry === "number" && Number.isFinite(entry))
  return false
}

function validateGraph(input: unknown): Validation {
  const errors: string[] = []
  const warnings: string[] = []
  if (!isRecord(input)) return { valid: false, errors: ["graph must be a JSON object"], warnings }
  if (input.version !== 1) errors.push(`unsupported StrikeGraph version: ${String(input.version)}`)
  if (!isRecord(input.schema)) errors.push("schema must be an object")
  if (!Array.isArray(input.entities)) errors.push("entities must be an array")
  if (!Array.isArray(input.relations)) errors.push("relations must be an array")
  if (errors.length) return { valid: false, errors, warnings }

  const graph = input as unknown as StrikeGraph
  if (!isRecord(graph.schema.entityTypes)) errors.push("schema.entityTypes must be an object")
  if (!isRecord(graph.schema.relationTypes)) errors.push("schema.relationTypes must be an object")
  if (errors.length) return { valid: false, errors, warnings }

  for (const [typeID, type] of Object.entries(graph.schema.entityTypes)) {
    if (!isRecord(type)) {
      errors.push(`entity type ${typeID} must be an object`)
      continue
    }
    if (type.required && (!Array.isArray(type.required) || !type.required.every((x) => typeof x === "string"))) {
      errors.push(`entity type ${typeID}: required must be a string array`)
    }
    if (type.properties) {
      if (!isRecord(type.properties)) errors.push(`entity type ${typeID}: properties must be an object`)
      else {
        for (const [name, propertyType] of Object.entries(type.properties)) {
          if (!PROPERTY_TYPES.has(String(propertyType))) errors.push(`entity type ${typeID}.${name}: unsupported property type ${String(propertyType)}`)
        }
      }
    }
  }

  for (const [relationID, relationType] of Object.entries(graph.schema.relationTypes)) {
    if (!isRecord(relationType)) {
      errors.push(`relation type ${relationID} must be an object`)
      continue
    }
    if (!Array.isArray(relationType.from) || !relationType.from.every((x) => typeof x === "string")) {
      errors.push(`relation type ${relationID}: from must be a string array`)
    }
    if (!Array.isArray(relationType.to) || !relationType.to.every((x) => typeof x === "string")) {
      errors.push(`relation type ${relationID}: to must be a string array`)
    }
    for (const typeID of [...(relationType.from ?? []), ...(relationType.to ?? [])]) {
      if (!graph.schema.entityTypes[typeID]) errors.push(`relation type ${relationID}: unknown entity type ${typeID}`)
    }
  }

  const entityIDs = new Set<string>()
  const entitiesByID = new Map<string, Entity>()
  for (const entity of graph.entities) {
    if (!isRecord(entity) || typeof entity.id !== "string" || !entity.id) {
      errors.push("entity missing non-empty id")
      continue
    }
    if (entityIDs.has(entity.id)) errors.push(`duplicate entity id: ${entity.id}`)
    entityIDs.add(entity.id)
    entitiesByID.set(entity.id, entity as Entity)
    if (typeof entity.type !== "string" || !graph.schema.entityTypes[entity.type]) {
      errors.push(`entity ${entity.id}: unknown type ${String(entity.type)}`)
      continue
    }
    if (!isRecord(entity.properties)) {
      errors.push(`entity ${entity.id}: properties must be an object`)
      continue
    }
    const schema = graph.schema.entityTypes[entity.type]
    for (const required of schema.required ?? []) {
      if (!(required in entity.properties)) errors.push(`entity ${entity.id}: missing required property ${required}`)
    }
    for (const [name, value] of Object.entries(entity.properties)) {
      const expected = schema.properties?.[name]
      if (!expected) warnings.push(`entity ${entity.id}: undeclared property ${name}`)
      else if (!valueMatches(value, expected)) errors.push(`entity ${entity.id}: property ${name} expected ${expected}`)
    }
    if (entity.type === "Action") {
      const mode = entity.properties.mode
      if (typeof mode !== "string" || !SAFE_ACTION_MODES.has(mode)) {
        errors.push(`entity ${entity.id}: Action.mode must be recommend, simulate, or approved`)
      }
    }
  }

  const relationIDs = new Set<string>()
  for (const relation of graph.relations) {
    if (!isRecord(relation) || typeof relation.id !== "string" || !relation.id) {
      errors.push("relation missing non-empty id")
      continue
    }
    if (relationIDs.has(relation.id)) errors.push(`duplicate relation id: ${relation.id}`)
    relationIDs.add(relation.id)
    const relationType = typeof relation.type === "string" ? graph.schema.relationTypes[relation.type] : undefined
    if (!relationType) {
      errors.push(`relation ${relation.id}: unknown type ${String(relation.type)}`)
      continue
    }
    const from = typeof relation.from === "string" ? entitiesByID.get(relation.from) : undefined
    const to = typeof relation.to === "string" ? entitiesByID.get(relation.to) : undefined
    if (!from) errors.push(`relation ${relation.id}: missing source entity ${String(relation.from)}`)
    if (!to) errors.push(`relation ${relation.id}: missing target entity ${String(relation.to)}`)
    if (from && !relationType.from.includes(from.type)) errors.push(`relation ${relation.id}: source type ${from.type} is not allowed`)
    if (to && !relationType.to.includes(to.type)) errors.push(`relation ${relation.id}: target type ${to.type} is not allowed`)
  }

  for (const entity of graph.entities.filter((entry) => entry.type === "Exposure")) {
    const assetID = entity.properties.assetId
    const vulnerabilityID = entity.properties.vulnerabilityId
    if (typeof assetID === "string" && entitiesByID.get(assetID)?.type !== "Asset") {
      errors.push(`exposure ${entity.id}: assetId must reference an Asset`)
    }
    if (typeof vulnerabilityID === "string" && entitiesByID.get(vulnerabilityID)?.type !== "Vulnerability") {
      errors.push(`exposure ${entity.id}: vulnerabilityId must reference a Vulnerability`)
    }
  }

  return { valid: errors.length === 0, errors, warnings }
}

function payload(input: string) {
  const parsed = JSON.parse(input)
  if (!isRecord(parsed)) throw new Error("payload must be a JSON object")
  return parsed
}

function result(value: unknown) {
  return JSON.stringify(value, null, 2)
}

const pathArg = tool.schema.string().optional().describe(`Graph path relative to the repository. Defaults to ${DEFAULT_PATH}`)

export const validate = tool({
  description: "Validate the defensive CyberStrike StrikeGraph schema, entity references, typed relations, required properties, and governed Action modes.",
  args: { path: pathArg },
  async execute(args, context) {
    const graph = await loadGraph(context, args.path)
    const validation = validateGraph(graph)
    return result({
      path: graphPath(context, args.path),
      ...validation,
      counts: {
        entityTypes: Object.keys(graph.schema.entityTypes).length,
        relationTypes: Object.keys(graph.schema.relationTypes).length,
        entities: graph.entities.length,
        relations: graph.relations.length,
      },
    })
  },
})

export const query = tool({
  description: "Query StrikeGraph entities and relations by id, entity type, relation type, text, or one-hop neighborhood.",
  args: {
    path: pathArg,
    id: tool.schema.string().optional(),
    entity_type: tool.schema.string().optional(),
    relation_type: tool.schema.string().optional(),
    text: tool.schema.string().optional(),
    neighbors_of: tool.schema.string().optional(),
    limit: tool.schema.number().int().min(1).max(500).optional(),
  },
  async execute(args, context) {
    const graph = await loadGraph(context, args.path)
    const validation = validateGraph(graph)
    if (!validation.valid) return result({ error: "StrikeGraph is invalid", ...validation })
    const text = args.text?.toLowerCase()
    const matchesText = (value: unknown) => !text || JSON.stringify(value).toLowerCase().includes(text)
    let entities = graph.entities.filter((entry) =>
      (!args.id || entry.id === args.id) && (!args.entity_type || entry.type === args.entity_type) && matchesText(entry),
    )
    let relations = graph.relations.filter((entry) =>
      (!args.id || entry.id === args.id) && (!args.relation_type || entry.type === args.relation_type) && matchesText(entry),
    )
    if (args.neighbors_of) {
      relations = graph.relations.filter((entry) => entry.from === args.neighbors_of || entry.to === args.neighbors_of)
      const ids = new Set([args.neighbors_of])
      for (const relation of relations) {
        ids.add(relation.from)
        ids.add(relation.to)
      }
      entities = graph.entities.filter((entry) => ids.has(entry.id))
    }
    const limit = args.limit ?? 100
    return result({
      entities: entities.slice(0, limit),
      relations: relations.slice(0, limit),
      matched: { entities: entities.length, relations: relations.length },
      truncated: entities.length > limit || relations.length > limit,
    })
  },
})

export const mutate = tool({
  description: "Apply a governed StrikeGraph mutation. Mutations are dry-run by default and only persist when commit=true and the resulting graph validates.",
  args: {
    path: pathArg,
    action: tool.schema.enum(["define_entity_type", "define_relation_type", "upsert_entity", "delete_entity", "add_relation", "delete_relation"]),
    payload: tool.schema.string().describe("JSON object for the mutation"),
    commit: tool.schema.boolean().optional().describe("Persist only after a successful dry-run. Defaults to false."),
  },
  async execute(args, context) {
    const graph = structuredClone(await loadGraph(context, args.path))
    const data = payload(args.payload)

    if (args.action === "define_entity_type") {
      const id = String(data.id ?? "")
      if (!id) throw new Error("define_entity_type requires payload.id")
      graph.schema.entityTypes[id] = {
        ...(Array.isArray(data.required) ? { required: data.required.map(String) } : {}),
        ...(isRecord(data.properties) ? { properties: data.properties as Record<string, PropertyType> } : {}),
      }
    }
    if (args.action === "define_relation_type") {
      const id = String(data.id ?? "")
      if (!id || !Array.isArray(data.from) || !Array.isArray(data.to)) {
        throw new Error("define_relation_type requires payload.id, payload.from[], and payload.to[]")
      }
      graph.schema.relationTypes[id] = { from: data.from.map(String), to: data.to.map(String) }
    }
    if (args.action === "upsert_entity") {
      const id = String(data.id ?? "")
      const type = String(data.type ?? "")
      if (!id || !type) throw new Error("upsert_entity requires payload.id and payload.type")
      const entity: Entity = { id, type, properties: isRecord(data.properties) ? data.properties : {} }
      const index = graph.entities.findIndex((entry) => entry.id === id)
      if (index >= 0) graph.entities[index] = entity
      else graph.entities.push(entity)
    }
    if (args.action === "delete_entity") {
      const id = String(data.id ?? "")
      if (!id) throw new Error("delete_entity requires payload.id")
      graph.entities = graph.entities.filter((entry) => entry.id !== id)
      graph.relations = graph.relations.filter((entry) => entry.from !== id && entry.to !== id)
    }
    if (args.action === "add_relation") {
      const id = String(data.id ?? "")
      const type = String(data.type ?? "")
      const from = String(data.from ?? "")
      const to = String(data.to ?? "")
      if (!id || !type || !from || !to) throw new Error("add_relation requires payload.id, payload.type, payload.from, and payload.to")
      const relation: Relation = { id, type, from, to, ...(isRecord(data.properties) ? { properties: data.properties } : {}) }
      const index = graph.relations.findIndex((entry) => entry.id === id)
      if (index >= 0) graph.relations[index] = relation
      else graph.relations.push(relation)
    }
    if (args.action === "delete_relation") {
      const id = String(data.id ?? "")
      if (!id) throw new Error("delete_relation requires payload.id")
      graph.relations = graph.relations.filter((entry) => entry.id !== id)
    }

    const validation = validateGraph(graph)
    if (!validation.valid) return result({ ok: false, committed: false, validation })
    const committed = args.commit === true
    if (committed) await saveGraph(context, graph, args.path)
    return result({
      ok: true,
      committed,
      validation,
      counts: { entities: graph.entities.length, relations: graph.relations.length },
      graph,
    })
  },
})

export const prioritize = tool({
  description: "Score defensive Exposure entities from 0-100 using KEV status, exploitability, internet exposure, asset criticality, privilege impact, detection coverage, and mitigation state.",
  args: {
    path: pathArg,
    limit: tool.schema.number().int().min(1).max(200).optional(),
    status: tool.schema.string().optional().describe("Optional Exposure status filter"),
  },
  async execute(args, context) {
    const graph = await loadGraph(context, args.path)
    const validation = validateGraph(graph)
    if (!validation.valid) return result({ error: "StrikeGraph is invalid", ...validation })
    const entitiesByID = new Map(graph.entities.map((entry) => [entry.id, entry]))
    const exposures = graph.entities.filter((entry) => entry.type === "Exposure" && (!args.status || entry.properties.status === args.status))
    const scored = exposures.map((exposure) => {
      const props = exposure.properties
      const asset = typeof props.assetId === "string" ? entitiesByID.get(props.assetId) : undefined
      const vuln = typeof props.vulnerabilityId === "string" ? entitiesByID.get(props.vulnerabilityId) : undefined
      const kev = props.kev === true || vuln?.properties.kev === true
      const internet = props.internetExposed === true || asset?.properties.internetExposed === true
      const exploitability = clamp(Number(props.exploitability ?? vuln?.properties.exploitability ?? 0))
      const criticality = clamp(Number(props.assetCriticality ?? asset?.properties.criticality ?? 0) / 5)
      const privilegeImpact = clamp(Number(props.privilegeImpact ?? 0))
      const detectionCoverage = clamp(Number(props.detectionCoverage ?? 0))
      const mitigated = props.mitigated === true
      let score = 0
      const reasons: string[] = []
      if (kev) { score += 30; reasons.push("known-exploited/KEV") }
      if (internet) { score += 20; reasons.push("internet-exposed") }
      score += exploitability * 20
      if (exploitability >= 0.7) reasons.push("high exploitability")
      score += criticality * 20
      if (criticality >= 0.8) reasons.push("critical asset")
      score += privilegeImpact * 10
      if (privilegeImpact >= 0.7) reasons.push("high privilege impact")
      score -= detectionCoverage * 10
      if (detectionCoverage >= 0.7) reasons.push("strong detection coverage")
      if (mitigated) { score -= 25; reasons.push("mitigation present") }
      score = Math.round(clamp(score, 0, 100))
      const priority = score >= 80 ? "P0" : score >= 60 ? "P1" : score >= 40 ? "P2" : "P3"
      return { id: exposure.id, score, priority, reasons, assetId: props.assetId, vulnerabilityId: props.vulnerabilityId, status: props.status }
    }).sort((a, b) => b.score - a.score)
    return result({
      formula: "KEV 30 + internet 20 + exploitability 20 + asset criticality 20 + privilege impact 10 - detection coverage 10 - mitigation 25; clamped 0-100",
      exposures: scored.slice(0, args.limit ?? 50),
      total: scored.length,
    })
  },
})
