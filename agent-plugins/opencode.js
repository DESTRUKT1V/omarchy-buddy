// Omarchy-Buddy for opencode 2.2 (plugin API v2). omarchy-buddy-setup puts a
// stub into ~/.config/opencode/plugins/ that imports this file.
//
// It runs in opencode's background service (`opencode serve --service`),
// which every opencode terminal shares. Its events go to
// `omarchy-buddy-hook --agent opencode` in Claude's shape, one after the
// other; the hook keeps the island's state and finds the terminal by the
// session's folder (like Codex's app-server).
//
// An approval (permission.asked) shows in the island with Allow / Always /
// Deny while opencode asks in its terminal as usual. The hook waits for the
// island (30 s at most); its answer goes back with ctx.permission.reply.
// Nothing here ever holds opencode up: no answer, no island, a missing hook
// or any error only means the terminal is where the user answers.
import { spawn } from "node:child_process"
import path from "node:path"
import { fileURLToPath } from "node:url"

const HOOK = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "bin", "omarchy-buddy-hook")
// opencode can run one setup per project folder in the same process: each event once.
const seen = (globalThis.__omarchyBuddySeen ??= new Set())
let queue = Promise.resolve()

function remember(map, key, value) {
  map.delete(key)
  map.set(key, value)
  if (map.size > 500) map.delete(map.keys().next().value)
}

// The hook with one event on stdin; resolves with its output ("" on any failure).
function run(event, onChild) {
  return new Promise((resolve) => {
    let out = ""
    try {
      const child = spawn(HOOK, ["--agent", "opencode"], { stdio: ["pipe", "pipe", "ignore"] })
      child.on("error", () => resolve(""))
      child.on("close", () => resolve(out))
      child.stdout.on("data", (d) => { out += d })
      child.stdin.on("error", () => {})
      child.stdin.end(JSON.stringify(event))
      onChild?.(child)
    } catch {
      resolve("")
    }
  })
}

// Status events one at a time and in order; none waits longer than 5 s for the one before.
function send(event) {
  queue = queue.then(() => Promise.race([run(event), new Promise((r) => setTimeout(r, 5000).unref?.())]))
}

// A tool's input in Claude's words: oldString → old_string, and a file
// tool's path (2.2: "path", maybe relative) → an absolute file_path, so the
// island can show the change as a diff. (The hook runs in the service's folder.)
function claudeInput(tool, input, cwd) {
  const out = {}
  for (const [k, v] of Object.entries(input && typeof input === "object" ? input : {}))
    out[k.replace(/[A-Z]/g, (c) => "_" + c.toLowerCase())] = v
  if (["read", "edit", "write"].includes(tool) && typeof out.path === "string") {
    out.file_path = path.resolve(cwd || "/", out.path)
    delete out.path
  }
  return out
}

export default {
  id: "omarchy-buddy",
  setup: async (ctx) => {
    const stop = new AbortController()
    const roots = new Map() // a subagent's session → the session it belongs to
    const folders = new Map() // session → its folder
    const prompts = new Map() // session → its latest prompt
    const tools = new Map() // tool call → {name, input}
    const waiting = new Map() // permission → the hook waiting for the island
    const answered = new Map() // permissions answered before their hook started

    function ask(d, base) {
      const call = tools.get(d.source?.id) || {}
      const command = (d.resources || []).join(" ")
      const event = {
        ...base, hook_event_name: "permission.asked", tool_name: d.action,
        tool_input: call.name === d.action ? claudeInput(d.action, call.input, base.cwd) : { command },
        // What "Always" saves, in the words of Claude's suggestions (the island shows them).
        permission_suggestions: (d.save || []).length ? [{
          type: "addRules", behavior: "allow", destination: "projectSettings",
          rules: d.save.map((p) => ({ toolName: d.action, ruleContent: p })),
        }] : [],
      }
      // After the events before it; the queue does not wait for the answer.
      queue = queue.then(() => void (!answered.has(d.id) && run(event, (child) => remember(waiting, d.id, child)).then((out) => {
        waiting.delete(d.id)
        let decision
        try {
          decision = JSON.parse(out).hookSpecificOutput.decision
        } catch {
          return // no answer from the island: the terminal asks
        }
        const reply = decision.behavior === "deny" ? "reject" : decision.updatedPermissions ? "always" : "once"
        // (answered in the terminal meanwhile: opencode refuses, nothing happens)
        Promise.resolve(ctx.permission.reply({ sessionID: d.sessionID, requestID: d.id, decision: reply })).catch(() => {})
      })))
    }

    function handle(e) {
      if (!e || typeof e.type !== "string" || seen.has(e.id)) return
      seen.add(e.id)
      if (seen.size > 2000) seen.delete(seen.values().next().value)
      const d = e.data || {}
      const sid = d.sessionID || d.form?.sessionID
      if (!sid) return
      if (e.type === "session.created" && d.parentID) remember(roots, sid, roots.get(d.parentID) || d.parentID)
      const folder = e.location?.directory || d.location?.directory
      if (folder) remember(folders, sid, folder)
      const root = roots.get(sid) || sid
      const sub = root !== sid
      const base = { session_id: root, cwd: folders.get(sid) || folders.get(root) || ctx.location?.directory || "" }
      if (sub) base.agent_id = sid
      switch (e.type) {
        case "session.inbox.enqueued":
          if (d.item?.type === "user") remember(prompts, sid, String(d.item.payload?.text || ""))
          return
        case "session.tool.input.started":
          remember(tools, d.id, { name: d.name, input: {} })
          return
        case "session.tool.called":
          remember(tools, d.id, { name: tools.get(d.id)?.name || "", input: d.input })
          return send({ ...base, hook_event_name: e.type, tool_name: tools.get(d.id).name, tool_use_id: d.id,
                        tool_input: claudeInput(tools.get(d.id).name, d.input, base.cwd) })
        case "session.tool.success":
        case "session.tool.failed":
          send({ ...base, hook_event_name: e.type, tool_name: tools.get(d.id)?.name || "", tool_use_id: d.id })
          return tools.delete(d.id)
        case "permission.asked":
          return ask(d, base)
        case "permission.replied":
          remember(answered, d.requestID, true)
          waiting.get(d.requestID)?.kill()
          return send({ ...base, hook_event_name: e.type })
        case "form.created": {
          const field = (d.form.fields || [])[0] || {}
          return send({ ...base, hook_event_name: e.type, tool_name: "question",
                        tool_input: { description: field.description || field.title || d.form.title || "" } })
        }
        case "form.replied":
        case "form.cancelled":
          return send({ ...base, hook_event_name: e.type })
      }
      if (sub) return // a subagent's run is part of its session's run
      if (e.type === "session.execution.started") send({ ...base, hook_event_name: e.type, prompt: prompts.get(sid) || "" })
      else if (e.type === "session.execution.interrupted" && d.reason !== "superseded") send({ ...base, hook_event_name: e.type })
      else if (["session.created", "session.execution.succeeded", "session.execution.failed", "session.deleted"].includes(e.type))
        send({ ...base, hook_event_name: e.type, source: "startup" })
    }

    ;(async () => {
      for await (const e of ctx.event.subscribe({ signal: stop.signal })) {
        try {
          handle(e)
        } catch {}
      }
    })().catch(() => {})
    return () => {
      stop.abort()
      for (const child of waiting.values()) child.kill() // the hook takes its request off the island
    }
  },
}
