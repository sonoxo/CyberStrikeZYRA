import { describe, expect, test } from "bun:test"
import type { TargetRecord } from "./model.ts"
import { authorizeAction, priority } from "./policy.ts"

const base: TargetRecord = {
  id: "target-1",
  name: "lab-api",
  kind: "domain",
  locator: "api.lab.internal",
  owner: "xunia",
  environment: "lab",
  criticality: 4,
  exposure: 4,
  confidence: 4,
  impact: 4,
  status: "observed",
  tags: [],
  createdAt: "2026-09-05T00:00:00.000Z",
  updatedAt: "2026-09-05T00:00:00.000Z",
}

describe("Target Shield policy", () => {
  test("active validation fails closed without authorization", () => {
    expect(authorizeAction(base, "scan").allowed).toBe(false)
  })

  test("passive observation is allowed without authorization", () => {
    expect(authorizeAction(base, "observe").allowed).toBe(true)
  })

  test("authorized scope permits active validation", () => {
    const target: TargetRecord = {
      ...base,
      status: "authorized",
      authorization: {
        owner: "xunia",
        approvedBy: "security-owner",
        scope: ["lab.internal"],
        reason: "defensive validation",
        validFrom: "2026-09-05T00:00:00.000Z",
        validUntil: "2026-09-06T00:00:00.000Z",
      },
    }
    const now = new Date("2026-09-05T12:00:00.000Z")
    expect(authorizeAction(target, "scan", now).allowed).toBe(true)
  })

  test("out-of-scope active validation is denied", () => {
    const target: TargetRecord = {
      ...base,
      authorization: {
        owner: "xunia",
        approvedBy: "security-owner",
        scope: ["other.internal"],
        reason: "defensive validation",
        validFrom: "2026-09-05T00:00:00.000Z",
        validUntil: "2026-09-06T00:00:00.000Z",
      },
    }
    const now = new Date("2026-09-05T12:00:00.000Z")
    expect(authorizeAction(target, "scan", now).allowed).toBe(false)
  })

  test("priority score is deterministic", () => {
    expect(priority(base).score).toBe(80)
    expect(priority(base).tier).toBe("P1")
  })
})
