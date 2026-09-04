const private4 = [
  /^10\./,
  /^127\./,
  /^192\.168\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
]

export type Scope = {
  mode: "lab" | "purple-team"
  targets: string[]
  authorization: string
  expires_at: number
}

export function target(value: string) {
  const host = value.trim().toLowerCase().replace(/^https?:\/\//, "").split(/[/:]/)[0]
  if (!host) return false
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".test")) return true
  if (private4.some((pattern) => pattern.test(host))) return true
  return false
}

export function scope(value: Scope) {
  if (!value.authorization.trim()) return { ok: false as const, reason: "authorization-required" }
  if (value.expires_at <= Date.now()) return { ok: false as const, reason: "authorization-expired" }
  if (!value.targets.length) return { ok: false as const, reason: "target-required" }
  if (!value.targets.every(target)) return { ok: false as const, reason: "lab-targets-only" }
  return { ok: true as const }
}

export function gate(value: Scope, stopped: boolean) {
  if (stopped) return { ok: false as const, reason: "kill-switch" }
  return scope(value)
}
