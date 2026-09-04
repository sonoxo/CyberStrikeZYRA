import { gate, type Scope } from "./policy"

export const BLACK_HOUSE_COLLECTIVE = 7_000_000
export const MAX_ACTIVE = 256
export const SHARD = 1_000

export type Mission = {
  id: string
  scope: Scope
  objective: "asset-inventory" | "control-validation" | "detection-validation" | "adversary-emulation"
  requested_agents?: number
}

export type Plan = {
  mission: string
  logical_agents: number
  shards: number
  active_cap: number
  execution: "virtualized"
  target_count: number
  objective: Mission["objective"]
}

export function plan(mission: Mission, stopped = false): Plan {
  const approved = gate(mission.scope, stopped)
  if (!approved.ok) throw new Error(`black-house-policy:${approved.reason}`)

  const logical_agents = Math.min(
    Math.max(mission.requested_agents ?? BLACK_HOUSE_COLLECTIVE, 1),
    BLACK_HOUSE_COLLECTIVE,
  )

  return {
    mission: mission.id,
    logical_agents,
    shards: Math.ceil(logical_agents / SHARD),
    active_cap: Math.min(MAX_ACTIVE, logical_agents),
    execution: "virtualized",
    target_count: mission.scope.targets.length,
    objective: mission.objective,
  }
}

export function batches(value: Plan) {
  return Array.from({ length: Math.ceil(value.shards / value.active_cap) }, (_, index) => ({
    index,
    first_shard: index * value.active_cap,
    shard_count: Math.min(value.active_cap, value.shards - index * value.active_cap),
  }))
}
