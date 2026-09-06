#!/usr/bin/env node

import { spawnSync } from "node:child_process"
import { access, readFile, writeFile } from "node:fs/promises"
import { join } from "node:path"

const USB_ROOT = process.env.GPT_DOUG_USB || "/Volumes/NO NAME"
const POCKET = join(USB_ROOT, "GPT-DOUG", "gpt-doug")
const API_BASE = process.env.GPT_DOUG_API || "http://127.0.0.1:9931/v1"
const PROVIDER_NAME = "GPT-DOUG-LLM"
const PROVIDER_ID = "gpt-doug-llm"

function run(command, args, options = {}) {
  return spawnSync(command, args, {
    cwd: options.cwd ?? process.cwd(),
    encoding: "utf8",
    stdio: options.inherit ? "inherit" : ["ignore", "pipe", "pipe"],
  })
}

async function exists(path) {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

async function sleep(ms) {
  await new Promise((resolve) => setTimeout(resolve, ms))
}

async function discoverPocketModels() {
  try {
    const response = await fetch(`${API_BASE.replace(/\/$/, "")}/models`, {
      signal: AbortSignal.timeout(2500),
      headers: { Accept: "application/json" },
    })
    if (!response.ok) return []
    const body = await response.json()
    if (!Array.isArray(body?.data)) return []
    return body.data.map((model) => String(model?.id ?? "").trim()).filter(Boolean)
  } catch {
    return []
  }
}

async function ensurePocketRuntime() {
  if (!(await exists(POCKET))) {
    throw new Error(`GPT-DOUG POCKET launcher not found at ${POCKET}. Make sure the flashed drive is mounted at ${USB_ROOT}.`)
  }

  let models = await discoverPocketModels()
  if (models.length > 0) {
    console.log(`✅ GPT-DOUG POCKET online at ${API_BASE}`)
    return models
  }

  console.log(`🚀 Starting GPT-DOUG POCKET from ${USB_ROOT}`)
  const start = run(POCKET, ["start"], { inherit: true })
  if (start.error) throw start.error
  if (start.status !== 0) throw new Error(`GPT-DOUG POCKET start exited with status ${start.status}`)

  for (let attempt = 1; attempt <= 30; attempt++) {
    models = await discoverPocketModels()
    if (models.length > 0) {
      console.log(`✅ GPT-DOUG POCKET online at ${API_BASE}`)
      return models
    }
    await sleep(1000)
  }

  throw new Error(`GPT-DOUG POCKET did not expose ${API_BASE}/models within 30 seconds`)
}

function cyberstrikeModels(providerID) {
  const probe = run("cyberstrike", ["models", providerID])
  if (probe.error?.code === "ENOENT") throw new Error("cyberstrike command not found in PATH")
  const out = `${probe.stdout ?? ""}\n${probe.stderr ?? ""}`
  return out
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.startsWith(`${providerID}/`))
}

async function setProjectDefaultModel(modelRef) {
  const configPath = join(process.cwd(), "cyberstrike.json")
  let config = {}
  try {
    config = JSON.parse(await readFile(configPath, "utf8"))
  } catch (error) {
    if (error?.code !== "ENOENT") throw error
  }
  config.model = modelRef
  await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`, "utf8")
  console.log(`✅ CyberStrike default model: ${modelRef}`)
}

async function main() {
  const localModels = await ensurePocketRuntime()
  console.log(`🧠 GPT-DOUG POCKET model(s): ${localModels.join(", ")}`)

  let configured = cyberstrikeModels(PROVIDER_ID)
  if (configured.length === 0) {
    console.log(`🔌 Registering ${PROVIDER_NAME} with CyberStrike`)
    const add = run(
      "cyberstrike",
      ["provider", "add", "--name", PROVIDER_NAME, "--url", API_BASE, "--scope", "project"],
      { inherit: true },
    )
    if (add.error) throw add.error
    if (add.status !== 0) throw new Error(`CyberStrike provider registration failed with status ${add.status}`)
    configured = cyberstrikeModels(PROVIDER_ID)
  }

  if (configured.length === 0) {
    throw new Error(`CyberStrike still cannot see ${PROVIDER_ID} models after registration`)
  }

  const preferredLocalID = localModels[0]
  const exact = configured.find((ref) => ref === `${PROVIDER_ID}/${preferredLocalID}`)
  const modelRef = exact ?? configured[0]
  await setProjectDefaultModel(modelRef)

  console.log("")
  console.log("🔥 GPT-DOUG-LLM LOCAL PROVIDER READY")
  console.log(`USB:      ${USB_ROOT}`)
  console.log(`Gateway:  ${API_BASE}`)
  console.log(`Provider: ${PROVIDER_ID}`)
  console.log(`Model:    ${modelRef}`)
  console.log("")
  console.log("Next:")
  console.log("  node packages/target-defense/target-shield.mjs launch xunia-local")
}

main().catch((error) => {
  console.error(`❌ ${error instanceof Error ? error.message : String(error)}`)
  process.exitCode = 1
})
