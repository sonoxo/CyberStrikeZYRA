import { describe, expect, test } from "bun:test"
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { resolve } from "node:path"
import { mutate, prioritize, validate } from "../../../.cyberstrike/tool/strikegraph"

function context(worktree: string) {
  return {
    sessionID: "strikegraph-test",
    messageID: "strikegraph-test",
    agent: "test",
    directory: worktree,
    worktree,
    abort: new AbortController().signal,
    metadata() {},
    async ask() {},
  }
}

async function fixture() {
  const root = await mkdtemp(resolve(tmpdir(), "cyberstrike-strikegraph-"))
  const repoRoot = resolve(import.meta.dir, "../../..")
  const seed = await readFile(resolve(repoRoot, ".cyberstrike/ontology/strikegraph.json"), "utf8")
  await mkdir(resolve(root, ".cyberstrike/ontology"), { recursive: true })
  await writeFile(resolve(root, ".cyberstrike/ontology/strikegraph.json"), seed, "utf8")
  return root
}

async function upsert(root: string, entity: Record<string, unknown>) {
  const output = JSON.parse(
    await mutate.execute(
      {
        action: "upsert_entity",
        payload: JSON.stringify(entity),
        commit: true,
      },
      context(root) as any,
    ),
  )
  expect(output.ok).toBe(true)
  expect(output.committed).toBe(true)
}

describe("StrikeGraph project tool", () => {
  test("seed graph validates", async () => {
    const repoRoot = resolve(import.meta.dir, "../../..")
    const output = JSON.parse(await validate.execute({}, context(repoRoot) as any))
    expect(output.valid).toBe(true)
    expect(output.errors).toEqual([])
    expect(output.counts.entityTypes).toBe(15)
    expect(output.counts.relationTypes).toBe(15)
    expect(output.counts.entities).toBe(8)
    expect(output.counts.relations).toBe(7)
  })

  test("prioritizes a known-exploited internet exposure as P0", async () => {
    const root = await fixture()
    try {
      await upsert(root, {
        id: "asset:prod:gateway",
        type: "Asset",
        properties: {
          name: "Production gateway",
          kind: "server",
          criticality: 5,
          environment: "production",
          internetExposed: true,
        },
      })
      await upsert(root, {
        id: "vuln:CVE-2099-0001",
        type: "Vulnerability",
        properties: {
          name: "Synthetic validation vulnerability",
          cve: "CVE-2099-0001",
          severity: "critical",
          kev: true,
          exploitability: 0.95,
        },
      })
      await upsert(root, {
        id: "exposure:gateway:CVE-2099-0001",
        type: "Exposure",
        properties: {
          name: "Synthetic production exposure",
          assetId: "asset:prod:gateway",
          vulnerabilityId: "vuln:CVE-2099-0001",
          internetExposed: true,
          privilegeImpact: 0.9,
          detectionCoverage: 0.1,
          mitigated: false,
          status: "open",
        },
      })

      const output = JSON.parse(await prioritize.execute({}, context(root) as any))
      expect(output.total).toBe(1)
      expect(output.exposures[0].priority).toBe("P0")
      expect(output.exposures[0].score).toBeGreaterThanOrEqual(80)
      expect(output.exposures[0].reasons).toContain("known-exploited/KEV")
      expect(output.exposures[0].reasons).toContain("internet-exposed")
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  test("rejects an ungoverned Action mode", async () => {
    const root = await fixture()
    try {
      const output = JSON.parse(
        await mutate.execute(
          {
            action: "upsert_entity",
            payload: JSON.stringify({
              id: "action:unsafe-test",
              type: "Action",
              properties: {
                name: "Unsafe autonomous action",
                mode: "execute",
                status: "proposed",
                requiresApproval: false,
              },
            }),
            commit: false,
          },
          context(root) as any,
        ),
      )
      expect(output.ok).toBe(false)
      expect(output.committed).toBe(false)
      expect(output.validation.valid).toBe(false)
      expect(output.validation.errors.some((entry: string) => entry.includes("Action.mode"))).toBe(true)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})
