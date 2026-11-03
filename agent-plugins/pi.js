// Omarchy-Buddy for Pi and Oh My Pi (omp). omarchy-buddy-setup puts a stub
// into ~/.pi/agent/extensions/ and ~/.omp/agent/extensions/ that imports
// this file and says which of the two runs it ("pi-agent" or "omp").
//
// Their extension events go to `omarchy-buddy-hook --agent NAME` in
// Claude's shape, one after the other; the hook translates them and keeps
// the island's state. Pi has no approvals of its own; omp says when it asks
// (tool_approval_requested), and only its terminal can answer. Pi awaits
// every handler, so nothing here waits for the island or throws.
import { spawn, spawnSync } from "node:child_process"
import path from "node:path"
import { fileURLToPath } from "node:url"

const HOOK = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "bin", "omarchy-buddy-hook")
// Pi's own names; the hook knows which of them count for which agent (omp: agent_end, Pi: agent_settled).
const EVENTS = ["session_start", "before_agent_start", "tool_call", "tool_execution_start", "tool_execution_end",
                "agent_end", "agent_settled", "tool_approval_requested", "tool_approval_resolved", "session_shutdown"]
let queue = Promise.resolve()

function run(agent, event) {
  return new Promise((resolve) => {
    try {
      const child = spawn(HOOK, ["--agent", agent], { stdio: ["pipe", "ignore", "ignore"] })
      child.on("error", resolve)
      child.on("close", resolve)
      child.stdin.on("error", () => {})
      child.stdin.end(JSON.stringify(event))
      child.unref() // Pi can quit while the hook still runs
    } catch {
      resolve()
    }
  })
}

// One at a time and in order; none waits longer than 5 s for the one before.
function send(agent, event) {
  queue = queue.then(() => Promise.race([run(agent, event), new Promise((r) => setTimeout(r, 5000).unref?.())]))
}

export default function (pi, agent = "pi-agent") {
  const inputs = new Map() // tool call → its input (omp's approval has none)
  for (const name of EVENTS) {
    pi.on(name, (event, ctx) => {
      try {
        // An omp subagent (task) works inside its session's run; a reload keeps the session.
        if (ctx?.agentKind === "sub" || (name === "session_shutdown" && event?.reason === "reload")) return
        const id = event?.toolCallId
        const input = event?.args ?? event?.input
        if (id && input) {
          inputs.set(id, input)
          if (inputs.size > 50) inputs.delete(inputs.keys().next().value)
        }
        if (name === "tool_call") return
        const e = { hook_event_name: name, session_id: String(ctx?.sessionManager?.getSessionId?.() || ""),
                    cwd: ctx?.cwd || process.cwd() }
        if (name === "session_start") e.source = event?.reason
        if (typeof event?.prompt === "string") e.prompt = event.prompt
        if (event?.toolName) Object.assign(e, { tool_name: event.toolName, tool_use_id: id, tool_input: inputs.get(id) || {} })
        if (event?.aborted) e.status = "aborted" // (Escape: the hook makes it an interruption)
        if (name === "tool_execution_end") inputs.delete(id)
        // Pi quits right after this one: written at once, or it never reaches the hook.
        if (name === "session_shutdown") spawnSync(HOOK, ["--agent", agent], { input: JSON.stringify(e), stdio: ["pipe", "ignore", "ignore"], timeout: 2000 })
        else send(agent, e)
      } catch {}
    })
  }
}
