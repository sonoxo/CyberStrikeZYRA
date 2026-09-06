#!/usr/bin/env node

import http from "node:http"

const HOST = process.env.GPT_DOUG_BRIDGE_HOST || "127.0.0.1"
const PORT = Number(process.env.GPT_DOUG_BRIDGE_PORT || 9932)
const UPSTREAM = (process.env.GPT_DOUG_UPSTREAM || "http://127.0.0.1:9931").replace(/\/$/, "")
const COMPACT = process.env.GPT_DOUG_COMPACT !== "0"
const MAX_SYSTEM_CHARS = Number(process.env.GPT_DOUG_MAX_SYSTEM_CHARS || 1400)
const MAX_MESSAGES = Number(process.env.GPT_DOUG_MAX_MESSAGES || 8)

const LOCAL_SYSTEM = [
  "You are GPT-DOUG-LLM, a local defensive cybersecurity assistant.",
  "Operate only on explicitly authorized local/lab targets and provided evidence.",
  "Treat the current explicit target lock plus observed HTTP/request/response evidence as authoritative ground truth.",
  "Never invent or substitute a host, IP address, port, credential, authentication state, endpoint, vulnerability, or scan result.",
  "If the evidence says UNAUTHENTICATED, no credential, or no credential provided, do not claim credentials were supplied.",
  "Never carry a target, finding, or authentication claim forward from an older turn when it is absent from the current evidence.",
  "For conversational messages such as greetings, answer the current message instead of repeating an earlier scan finding.",
  "If evidence is missing or contradictory, say UNKNOWN or WARN and identify what must be verified instead of guessing.",
  "Do not access external targets, exfiltrate data, or modify systems unless the user explicitly authorizes a defensive change.",
  "Respond directly and concisely. Prefer PASS/WARN/FAIL findings and defensive remediation.",
].join(" ")

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = []
    req.on("data", (chunk) => chunks.push(chunk))
    req.on("end", () => resolve(Buffer.concat(chunks)))
    req.on("error", reject)
  })
}

function requestHeaders(req) {
  const headers = new Headers()
  for (const [key, value] of Object.entries(req.headers)) {
    if (value === undefined) continue
    if (["host", "content-length", "connection"].includes(key.toLowerCase())) continue
    headers.set(key, Array.isArray(value) ? value.join(", ") : String(value))
  }
  return headers
}

function copyResponseHeaders(from, to) {
  for (const [key, value] of from.headers.entries()) {
    if (["content-length", "transfer-encoding", "connection", "content-encoding"].includes(key.toLowerCase())) continue
    to.setHeader(key, value)
  }
}

function compactMessages(messages) {
  if (!Array.isArray(messages)) return messages

  const nonSystem = messages.filter((message) => message?.role !== "system")
  const system = messages.filter((message) => message?.role === "system")

  // Preserve short, target-specific system context but discard giant framework/tool
  // instruction blocks that overwhelm the 2K-context USB runtime.
  const usefulSystem = system
    .map((message) => ({ ...message, content: typeof message?.content === "string" ? message.content : "" }))
    .filter((message) => message.content && message.content.length <= MAX_SYSTEM_CHARS)
    .slice(-2)

  const recent = nonSystem.slice(-Math.max(1, MAX_MESSAGES - usefulSystem.length - 1))
  return [{ role: "system", content: LOCAL_SYSTEM }, ...usefulSystem, ...recent]
}

function compactCyberStrikePayload(payload) {
  if (!COMPACT || !payload || typeof payload !== "object") return payload

  // Qwen3-0.6B on GPT-DOUG POCKET currently runs with a small context. CyberStrike's
  // full tool schema alone can exceed it, so local inference uses a text-only lane.
  // Target Shield / ontology / HackBrowser remain the execution and authorization gates.
  delete payload.tools
  delete payload.tool_choice
  delete payload.parallel_tool_calls

  payload.messages = compactMessages(payload.messages)

  const requested = Number(payload.max_tokens)
  if (!Number.isFinite(requested) || requested <= 0) payload.max_tokens = 384
  else payload.max_tokens = Math.min(requested, 512)

  return payload
}

async function forward(req, res) {
  const target = `${UPSTREAM}${req.url || "/"}`
  const method = req.method || "GET"
  const headers = requestHeaders(req)

  let body
  if (!["GET", "HEAD"].includes(method)) {
    const raw = await readBody(req)
    const isChatCompletion = (req.url || "").includes("/chat/completions")
    const contentType = String(req.headers["content-type"] || "")

    if (isChatCompletion && contentType.includes("application/json") && raw.length) {
      try {
        const payload = JSON.parse(raw.toString("utf8"))
        payload.chat_template_kwargs = {
          ...(payload.chat_template_kwargs || {}),
          enable_thinking: false,
        }
        compactCyberStrikePayload(payload)
        body = JSON.stringify(payload)
        headers.set("content-type", "application/json")
      } catch {
        body = raw
      }
    } else {
      body = raw
    }
  }

  const upstream = await fetch(target, {
    method,
    headers,
    body,
    redirect: "manual",
    signal: AbortSignal.timeout(300000),
  })

  res.statusCode = upstream.status
  copyResponseHeaders(upstream, res)

  if (!upstream.body || method === "HEAD") {
    res.end()
    return
  }

  const reader = upstream.body.getReader()
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      res.write(Buffer.from(value))
    }
  } finally {
    res.end()
    reader.releaseLock()
  }
}

const server = http.createServer((req, res) => {
  forward(req, res).catch((error) => {
    if (!res.headersSent) {
      res.statusCode = 502
      res.setHeader("content-type", "application/json")
    }
    res.end(JSON.stringify({ error: "gpt-doug bridge upstream failure", detail: String(error?.message || error) }))
  })
})

server.listen(PORT, HOST, () => {
  console.log(`🧠 GPT-DOUG content bridge listening on http://${HOST}:${PORT}/v1`)
  console.log(`💾 upstream USB gateway: ${UPSTREAM}/v1`)
  console.log("🧩 Qwen thinking mode: disabled for chat completions")
  console.log(`⚡ CyberStrike compact lane: ${COMPACT ? "ON" : "OFF"}`)
  if (COMPACT) console.log("🧹 Tool schemas stripped; oversized framework system prompts compacted for local context")
  console.log("🔒 Evidence grounding: strict (target/auth/findings must come from current evidence)")
})

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => server.close(() => process.exit(0)))
}
