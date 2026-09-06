#!/usr/bin/env node

import http from "node:http"

const HOST = process.env.GPT_DOUG_BRIDGE_HOST || "127.0.0.1"
const PORT = Number(process.env.GPT_DOUG_BRIDGE_PORT || 9932)
const UPSTREAM = (process.env.GPT_DOUG_UPSTREAM || "http://127.0.0.1:9931").replace(/\/$/, "")

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = []
    req.on("data", (chunk) => chunks.push(chunk))
    req.on("end", () => resolve(Buffer.concat(chunks)))
    req.on("error", reject)
  })
}

function copyResponseHeaders(from, to) {
  for (const [key, value] of from.headers.entries()) {
    if (["content-length", "transfer-encoding", "connection"].includes(key.toLowerCase())) continue
    to.setHeader(key, value)
  }
}

async function forward(req, res) {
  const target = `${UPSTREAM}${req.url || "/"}`
  const method = req.method || "GET"
  const headers = { ...req.headers }
  delete headers.host
  delete headers["content-length"]

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
        body = JSON.stringify(payload)
        headers["content-type"] = "application/json"
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
})

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => server.close(() => process.exit(0)))
}
