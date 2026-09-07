import { describe, expect, test } from "bun:test"
import { fire, manifest } from "./index"

describe("black house arsenal", () => {
  test("publishes five simulation-only weapons", () => {
    const items = manifest()
    expect(items).toHaveLength(5)
    expect(items.every((item) => item.safety === "simulation-only")).toBe(true)
    expect(items.every((item) => item.network === false)).toBe(true)
    expect(items.every((item) => item.destructive === false)).toBe(true)
  })

  test("fires deterministic telemetry in a lab scope", () => {
    const events = fire("ghost-scan", {
      target: "10.0.0.10",
      intensity: 3,
      seed: 1,
    })

    expect(events).toHaveLength(6)
    expect(events[0].signal).toBe("synthetic-port-observation:80")
    expect(events.every((event) => event.effect === "telemetry-only")).toBe(true)
  })

  test("rejects public targets", () => {
    expect(() =>
      fire("glass-needle", {
        target: "example.com",
      }),
    ).toThrow("black-house-arsenal:lab-targets-only")
  })

  test("honors the global stop state", () => {
    expect(() =>
      fire("deadbolt", {
        target: "localhost",
        stopped: true,
      }),
    ).toThrow("black-house-arsenal:kill-switch")
  })

  test("caps event volume", () => {
    expect(
      fire("smoke-exfil", {
        target: "purple-team.test",
        intensity: 10_000,
      }),
    ).toHaveLength(200)
  })
})
