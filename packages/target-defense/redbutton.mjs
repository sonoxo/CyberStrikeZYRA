#!/usr/bin/env node

import { spawnSync } from "node:child_process"
import { fileURLToPath } from "node:url"
import { dirname, join, resolve } from "node:path"

const here = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(here, "../..")
const providerBootstrap = join(here, "provider-bootstrap.mjs")
const ontology = join(here, "ontology.mjs")
const shield = join(here, "target-shield.mjs")

const args = process.argv.slice(2)
const command = args[0] ?? "open"

function run(bin, argv, options = {}) {
  const child = spawnSync(bin, argv, {
    cwd: repoRoot,
    stdio: options.capture ? ["ignore", "pipe", "pipe"] : "inherit",
    encoding: options.capture ? "utf8" : undefined,
    env: process.env,
  })
  if (child.error?.code === "ENOENT") throw new Error(`${bin} command not found in PATH`)
  if (child.error) throw child.error
  if (typeof child.status === "number" && child.status !== 0 && !options.allowFailure) {
    throw new Error(`${bin} ${argv.join(" ")} exited with status ${child.status}`)
  }
  return child
}

function banner() {
  console.log(`
🔴 REDBUTTON // XUNIA DEFENSIVE CONTROL
─────────────────────────────────────
💾 GPT-DOUG POCKET
🧠 GPT-DOUG-LLM LOCAL
🧬 TARGET SHIELD ONTOLOGY
🎯 AUTHORIZATION GATE
🛡️ CYBERSTRIKE
`)
}

function preflight() {
  banner()
  console.log("[1/3] 🧠 Binding GPT-DOUG POCKET local provider")
  run(process.execPath, [providerBootstrap])

  console.log("[2/3] 🧬 Syncing + validating Target Shield ontology")
  run(process.execPath, [ontology, "sync"])

  console.log("[3/3] 🩺 Checking CyberStrike / browser runtime")
  run(process.execPath, [shield, "doctor"])
}

function help() {
  console.log(`RedButton — XUNIA defensive launcher

Usage:
  RedButton                 preflight stack, then open CyberStrike TUI
  RedButton cyberstrike     same as above
  RedButton TARGET          preflight, then launch authorized local/lab TARGET
  RedButton status          show provider, ontology, Target Shield and CyberStrike status
  RedButton ontology        sync and validate ontology only
  RedButton doctor          run Target Shield runtime doctor
  RedButton help            show this help

Examples:
  RedButton
  RedButton xunia-local
  RedButton status

Active target execution remains fail-closed behind Target Shield authorization and local/lab restrictions.`)
}

function status() {
  banner()
  console.log("=== GPT-DOUG / CYBERSTRIKE PROVIDER ===")
  run("cyberstrike", ["models", "gpt-doug-llm"], { allowFailure: true })
  console.log("\n=== ONTOLOGY ===")
  run(process.execPath, [ontology, "summary"], { allowFailure: true })
  console.log("\n=== TARGET SHIELD ===")
  run(process.execPath, [shield, "list"], { allowFailure: true })
  console.log("\n=== RUNTIME ===")
  run(process.execPath, [shield, "doctor"], { allowFailure: true })
}

try {
  if (["help", "--help", "-h"].includes(command)) {
    help()
  } else if (command === "status") {
    status()
  } else if (command === "ontology") {
    banner()
    run(process.execPath, [ontology, "sync"])
  } else if (command === "doctor") {
    banner()
    run(process.execPath, [shield, "doctor"])
  } else if (["open", "cyberstrike"].includes(command)) {
    preflight()
    console.log("🚀 Opening CyberStrike")
    run("cyberstrike", [])
  } else {
    preflight()
    console.log(`🎯 Requesting Target Shield launch for ${command}`)
    run(process.execPath, [shield, "launch", command])
  }
} catch (error) {
  console.error(`\n❌ REDBUTTON NO-GO: ${error instanceof Error ? error.message : String(error)}`)
  process.exitCode = 1
}
