import { target } from "../collective/policy"

export type WeaponId =
  | "ghost-scan"
  | "velvet-hammer"
  | "glass-needle"
  | "smoke-exfil"
  | "deadbolt"

export type WeaponContext = {
  target: string
  intensity?: number
  seed?: number
  stopped?: boolean
}

export type WeaponEvent = {
  weapon: WeaponId
  target: string
  sequence: number
  tactic: string
  technique: string
  signal: string
  effect: "telemetry-only"
  network: false
  destructive: false
}

const clamp = (value = 10) => Math.min(Math.max(Math.floor(value), 1), 100)

const make = (
  weapon: WeaponId,
  context: WeaponContext,
  tactic: string,
  technique: string,
  signals: string[],
) => {
  if (context.stopped) throw new Error("black-house-arsenal:kill-switch")
  if (!target(context.target)) throw new Error("black-house-arsenal:lab-targets-only")

  const count = Math.min(clamp(context.intensity) * 2, 200)
  const seed = Math.abs(Math.floor(context.seed ?? 0))

  return Array.from({ length: count }, (_, sequence): WeaponEvent => ({
    weapon,
    target: context.target,
    sequence,
    tactic,
    technique,
    signal: signals[(sequence + seed) % signals.length],
    effect: "telemetry-only",
    network: false,
    destructive: false,
  }))
}

export const arsenal = {
  "ghost-scan": (context: WeaponContext) =>
    make("ghost-scan", context, "discovery", "service-discovery", [
      "synthetic-port-observation:22",
      "synthetic-port-observation:80",
      "synthetic-port-observation:443",
      "synthetic-port-observation:8080",
    ]),

  "velvet-hammer": (context: WeaponContext) =>
    make("velvet-hammer", context, "credential-access", "auth-pressure-simulation", [
      "synthetic-auth-failure:user-0001",
      "synthetic-auth-failure:user-0002",
      "synthetic-auth-lockout-threshold",
    ]),

  "glass-needle": (context: WeaponContext) =>
    make("glass-needle", context, "initial-access", "injection-detection-simulation", [
      "synthetic-probe:quote-boundary",
      "synthetic-probe:template-boundary",
      "synthetic-probe:path-boundary",
    ]),

  "smoke-exfil": (context: WeaponContext) =>
    make("smoke-exfil", context, "exfiltration", "egress-detection-simulation", [
      "synthetic-egress:1kb:collector.test",
      "synthetic-egress:8kb:collector.test",
      "synthetic-egress:32kb:collector.test",
    ]),

  deadbolt: (context: WeaponContext) =>
    make("deadbolt", context, "impact", "ransomware-detection-simulation", [
      "synthetic-file-canary:rename-intent",
      "synthetic-file-canary:entropy-spike",
      "synthetic-file-canary:recovery-note-marker",
    ]),
} satisfies Record<WeaponId, (context: WeaponContext) => WeaponEvent[]>

export function fire(id: WeaponId, context: WeaponContext) {
  return arsenal[id](context)
}

export function manifest() {
  return (Object.keys(arsenal) as WeaponId[]).map((id) => ({
    id,
    safety: "simulation-only" as const,
    network: false as const,
    destructive: false as const,
  }))
}
