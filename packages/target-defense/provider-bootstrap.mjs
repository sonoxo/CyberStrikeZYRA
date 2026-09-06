#!/usr/bin/env node

import { spawn, spawnSync } from "node:child_process"
import { access, readFile, writeFile } from "node:fs/promises"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const here = dirname(fileURLToPath(import.meta.url))
const USB_ROOT = process.env.GPT_DOUG_USB || "/Volumes/NO NAME"
const POCKET = join(USB_ROOT, "GPT-DOUG", "gpt-doug")
const UPSTREAM_API = process.env.GPT_DOUG_UPSTREAM_API || "http://127.0.0.1:9931/v1"
const BRIDGE_API = process.env.GPT_DOUG_API || "http://127.0.0.1:9932/v1"
const BRIDGE = join(here, "qwen-content-bridge.mjs")
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
  try { await access(path); return true } catch { return false }
}

async function sleep(ms) {
  await new Promise((resolve) => setTimeout(resolve, ms))
}

async function discoverModels(apiBase, timeout = 2500) {
  try {
    const response = await fetch(`${apiBase.replace(/\/$/, "")}/models`, {
      signal: AbortSignal.timeout(timeout),
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

  let models = await discoverModels(UPSTREAM_API)
  if (models.length > 0) {
    console.log(`✅ GPT-DOUG POCKET online at ${UPSTREAM_API}`)
    return models
  }

  console.log(`🚀 Starting GPT-DOUG POCKET from ${USB_ROOT}`)
  const start = run(POCKET, ["start"], { inherit: true })
  if (start.error) throw start.error
  if (start.status !== 0) throw new Error(`GPT-DOUG POCKET start exited with status ${start.status}`)

  for (let attempt = 1; attempt <= 30; attempt++) {
    models = await discoverModels(UPSTREAM_API)
    if (models.length > 0) {
      console.log(`✅ GPT-DOUG POCKET online at ${UPSTREAM_API}`)
      return models
    }
    await sleep(1000)
  }

  throw new Error(`GPT-DOUG POCKET did not expose ${UPSTREAM_API}/models within 30 seconds`)
}

async function ensureContentBridge() {
  let models = await discoverModels(BRIDGE_API, 1000)
  if (models.length > 0) {
    console.log(`✅ GPT-DOUG content bridge online at ${BRIDGE_API}`)
    return models
  }

  console.log("🧩 Starting local Qwen no-thinking content bridge")
  const child = spawn(process.execPath, [BRIDGE], {
    cwd: process.cwd(),
    detached: true,
    stdio: "ignore",
    env: {
      ...process.env,
      GPT_DOUG_UPSTREAM: UPSTREAM_API.replace(/\/v1\/?$/, ""),
      GPT_DOUG_BRIDGE_HOST: "127.0.0.1",
      GPT_DOUG_BRIDGE_PORT: String(new URL(BRIDGE_API).port || 9932),
    },
  })
  child.unref()

  for (let attempt = 1; attempt <= 20; attempt++) {
    models = await discoverModels(BRIDGE_API, 1000)
    if (models.length > 0) {
      console.log(`✅ GPT-DOUG content bridge online at ${BRIDGE_API}`)
      return models
    }
    await sleep(250)
  }

  throw new Error(`GPT-DOUG content bridge did not expose ${BRIDGE_API}/models`)
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

async function readProjectConfig() {
  try { return JSON.parse(await readFile(join(process.cwd(), "cyberstrike.json"), "utf8")) }
  catch (error) {
    if (error?.code === "ENOENT") return {}
    throw error
  }
}

async function ensureCyberStrikeProvider() {
  const config = await readProjectConfig()
  const currentApi = config?.provider?.[PROVIDER_ID]?.api
  const expectedApi = BRIDGE_API.replace(/\/$/, "")

  if (currentApi && currentApi.replace(/\/$/, "") !== expectedApi) {
    console.log(`🔁 Rebinding ${PROVIDER_ID} from ${currentApi} → ${expectedApi}`)
    const remove = run("cyberstrike", ["provider", "remove", PROVIDER_ID], { inherit: true })
    if (remove.error) throw remove.error
  }

  let configured = cyberstrikeModels(PROVIDER_ID)
  if (configured.length === 0 || currentApi?.replace(/\/$/, "") !== expectedApi) {
    console.log(`🔌 Registering ${PROVIDER_NAME} with CyberStrike via local content bridge`)
    const add = run(
      "cyberstrike",
      ["provider", "add", "--name", PROVIDER_NAME, "--url", BRIDGE_API, "--scope", "project"],
      { inherit: true },
    )
    if (add.error) throw add.error
    if (add.status !== 0) throw new Error(`CyberStrike provider registration failed with status ${add.status}`)
    configured = cyberstrikeModels(PROVIDER_ID)
  }

  return configured
}

async function setProjectDefaultModel(modelRef) {
  const configPath = join(process.cwd(), "cyberstrike.json")
  const config = await readProjectConfig()
  config.model = modelRef
  await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`, "utf8")
  console.log(`✅ CyberStrike default model: ${modelRef}`)
}

async function verifyContent(modelID) {
  try {
    const response = await fetch(`${BRIDGE_API.replace(/\/$/, "")}/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: modelID,
        messages: [{ role: "user", content: "Reply exactly: GPT-DOUG BRIDGE ONLINE" }],
        temperature: 0,
        max_tokens: 64,
      }),
      signal: AbortSignal.timeout(10000),
    })
    if (!response.ok) return false
    const body = await response.json()
    return Boolean(body?.choices?.[0]?.message?.content)
  } catch {
    return false
  }
}

async function main() {
  const upstreamModels = await ensurePocketRuntime()
  console.log(`🧠 GPT-DOUG POCKET model(s): ${upstreamModels.join(", ")}`)

  const bridgeModels = await ensureContentBridge()
  const configured = await ensureCyberStrikeProvider()
  if (configured.length === 0) throw new Error(`CyberStrike cannot see ${PROVIDER_ID} models`)

  const preferredLocalID = bridgeModels[0] ?? upstreamModels[0]
  const exact = configured.find((ref) => ref === `${PROVIDER_ID}/${preferredLocalID}`)
  const modelRef = exact ?? configured[0]
  await setProjectDefaultModel(modelRef)

  const contentReady = await verifyContent(preferredLocalID)
  if (!contentReady) throw new Error("GPT-DOUG bridge responded without assistant content")

  console.log("")
  console.log("🔥 GPT-DOUG-LLM LOCAL PROVIDER READY")
  console.log(`USB:       ${USB_ROOT}`)
  console.log(`Upstream:  ${UPSTREAM_API}`)
  console.log(`Bridge:    ${BRIDGE_API}`)
  console.log(`Provider:  ${PROVIDER_ID}`)
  console.log(`Model:     ${modelRef}`)
  console.log("Thinking:  OFF for CyberStrike chat completions")
  console.log("Content:   VERIFIED")
  console.log("")
  console.log("Next:")
  console.log("  node packages/target-defense/target-shield.mjs launch xunia-local")
}

main().catch((error) => {
  console.error(`❌ ${error instanceof Error ? error.message : String(error)}`)
  process.exitCode = 1
})
