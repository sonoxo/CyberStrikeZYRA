#!/usr/bin/env node

import { spawnSync } from "node:child_process"

function run(args, options = {}) {
  return spawnSync("cyberstrike", args, {
    encoding: "utf8",
    stdio: options.inherit ? "inherit" : ["inherit", "pipe", "pipe"],
  })
}

function models() {
  const probe = run(["models"])
  if (probe.error?.code === "ENOENT") {
    console.error("❌ cyberstrike command not found")
    process.exit(1)
  }
  const out = `${probe.stdout ?? ""}\n${probe.stderr ?? ""}`.trim()
  const lines = out.split(/\r?\n/).map((x) => x.trim()).filter(Boolean)
  const modelLines = lines.filter((x) => /^[a-z0-9_.-]+\/.+/i.test(x))
  return { ready: probe.status === 0 && modelLines.length > 0, modelLines, raw: out }
}

const before = models()
if (before.ready) {
  console.log("✅ CyberStrike provider/model ready")
  console.log(before.modelLines.slice(0, 12).join("\n"))
  process.exit(0)
}

console.log("⚠️  CyberStrike has no usable provider/model configured.")
console.log("")
console.log("HackBrowser-compatible choices:")
console.log("  1) GitHub Copilot auth (no separate API key if your GitHub account has access)")
console.log("  2) Anthropic subscription/API auth")
console.log("  3) Any API-key provider")
console.log("  4) A local OpenAI-compatible endpoint via `cyberstrike provider add`")
console.log("")
console.log("For the interactive login below, GitHub Copilot is the preferred subscription path for HackBrowser.")

const login = run(["auth", "login"], { inherit: true })
if (login.error) {
  console.error(`❌ provider login failed: ${login.error.message}`)
  process.exit(1)
}
if (login.status !== 0) process.exit(login.status ?? 1)

const after = models()
if (!after.ready) {
  console.error("❌ Login completed but CyberStrike still reports no usable models.")
  console.error("Try a local OpenAI-compatible endpoint:")
  console.error("  cyberstrike provider add")
  process.exit(2)
}

console.log("✅ CyberStrike provider/model ready")
console.log(after.modelLines.slice(0, 12).join("\n"))
