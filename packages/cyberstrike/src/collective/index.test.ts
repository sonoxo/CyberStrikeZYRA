import { describe, expect, test } from "bun:test"
import { BLACK_HOUSE_COLLECTIVE, MAX_ACTIVE, batches, plan } from "."

const mission = {
  id: "black-house-lab",
  objective: "adversary-emulation" as const,
  scope: {
    mode: "purple-team" as const,
    targets: ["127.0.0.1", "10.20.30.40", "demo.test"],
    authorization: "lab-approval",
    expires_at: Date.now() + 60_000,
  },
}

describe("black house collective", () => {
  test("represents seven million logical agents without spawning them", () => {
    const value = plan(mission)
    expect(value.logical_agents).toBe(BLACK_HOUSE_COLLECTIVE)
    expect(value.shards).toBe(7000)
    expect(value.active_cap).toBe(MAX_ACTIVE)
    expect(value.execution).toBe("virtualized")
    expect(batches(value).length).toBe(28)
  })

  test("blocks public targets", () => {
    expect(() =>
      plan({
        ...mission,
        scope: { ...mission.scope, targets: ["example.com"] },
      }),
    ).toThrow("black-house-policy:lab-targets-only")
  })

  test("honors kill switch", () => {
    expect(() => plan(mission, true)).toThrow("black-house-policy:kill-switch")
  })
})
