"use strict"
// Real Claude Code hook inputs (tests/fixtures/hook-events and
// hook-events-interactive, recorded with tests/record-hook-events) and Codex
// ones (codex-events, tests/record-codex-events) go through
// omarchy-buddy-hook in their recorded order, in an own
// XDG_RUNTIME_DIR and HOME (the live island sees nothing); the recorded
// status line input goes through omarchy-buddy-statusline. When Claude Code
// changes its format, this is where it shows: a field the hook reads is
// gone, or the island no longer gets what it shows.
const test = require("node:test")
const assert = require("node:assert/strict")
const fs = require("node:fs")
const os = require("node:os")
const path = require("node:path")
const { spawn, spawnSync } = require("node:child_process")
const SessionLogic = require("./lib/load").load("SessionLogic.js")

const HOOK = path.join(__dirname, "..", "bin", "omarchy-buddy-hook")
const STATUSLINE = path.join(__dirname, "..", "bin", "omarchy-buddy-statusline")
const FIXTURES = path.join(__dirname, "fixtures")
const events = []
for (const dir of ["hook-events", "hook-events-interactive"]) {
  for (const f of fs.readdirSync(path.join(FIXTURES, dir)).filter(f => f.endsWith(".json")).sort())
    events.push({ file: dir + "/" + f, event: JSON.parse(fs.readFileSync(path.join(FIXTURES, dir, f), "utf8")) })
}
const codexEvents = fs.readdirSync(path.join(FIXTURES, "codex-events")).filter(f => f.endsWith(".json")).sort()
  .map(f => ({ file: "codex-events/" + f, event: JSON.parse(fs.readFileSync(path.join(FIXTURES, "codex-events", f), "utf8")) }))
// Further agents (#141), recorded against a stand-in model server without
// login: what each event must leave in state.json. Their hooks go on in the
// background, so the test waits for the change.
// Pi and Oh My Pi (#142): what our plugin (agent-plugins/pi.js) handed the
// hook in a real session.
const otherEvents = [["gemini", ["--agent", "gemini"], {}], ["crush", ["--agent", "crush"], {}],
                     ["grok", [], { GROK_HOOK_EVENT: "x" }], ["pi-agent", ["--agent", "pi-agent"], {}, "pi-events"],
                     ["omp", ["--agent", "omp"], {}]].map(([agent, args, extra, folder]) => {
  const dir = folder || agent + "-events"
  const list = fs.readdirSync(path.join(FIXTURES, dir)).filter(f => f.endsWith(".json")).sort()
    .map(f => ({ file: dir + "/" + f, event: JSON.parse(fs.readFileSync(path.join(FIXTURES, dir, f), "utf8")) }))
  return { agent, args, extra, list }
})
const statusLine = JSON.parse(fs.readFileSync(path.join(FIXTURES, "statusline.json"), "utf8"))

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "hook-fixtures-"))
const env = Object.assign({}, process.env, { LC_ALL: "", LC_MESSAGES: "", LANG: "de_DE.UTF-8", XDG_RUNTIME_DIR: tmp, HOME: tmp, XDG_STATE_HOME: path.join(tmp, "state"), XDG_CONFIG_HOME: path.join(tmp, "config"),
                                             ORCA_PANE_KEY: "fake:pane", ORCA_WORKTREE_ID: "fake", HYPRLAND_INSTANCE_SIGNATURE: "test" })
const STATE = path.join(tmp, "omarchy-buddy", "state.json")
test.after(() => fs.rmSync(tmp, { recursive: true, force: true }))

function state() {
  try { return JSON.parse(fs.readFileSync(STATE, "utf8")) } catch (e) { return {} }
}

// The island's sign of life: without it the hook does not wait.
function islandAlive() {
  fs.mkdirSync(path.join(tmp, "omarchy-buddy"), { recursive: true })
  fs.writeFileSync(path.join(tmp, "omarchy-buddy", "island"), String(Date.now()))
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)) }

async function until(check) {
  for (let i = 0; i < 50; i++) { if (check()) return true; await sleep(100) }
  return false
}

// How the island answers each kind of request: the first option of every
// question (the first two when several count), a plan in auto mode,
// everything else allowed.
function islandAnswer(request) {
  if (request.kind === "question") {
    const answers = {}
    for (const q of request.questions) answers[q.question] = q.options.slice(0, q.multiSelect ? 2 : 1).map(o => o.label)
    return [["--answer"], JSON.stringify(answers)]  // the answers on stdin (#219)
  }
  return [["--decide", request.kind === "plan" ? "auto" : "allow"], ""]
}

// Answers a PermissionRequest the way the island does.
function askAndAllow(event, args) {
  return new Promise((resolve, reject) => {
    islandAlive()
    const p = spawn(HOOK, args, { env })
    let out = ""
    p.stdout.on("data", d => { out += d })
    p.on("error", reject)
    p.on("close", code => resolve({ code, out, request }))
    let request = null
    until(() => (state()[event.session_id] || {}).requests).then(found => {
      if (!found) { p.kill(); return }
      request = state()[event.session_id].requests[0]
      const [[flag, ...rest], input] = islandAnswer(request)
      spawnSync(HOOK, [flag, event.session_id, request.id, ...rest], { env, input })
    })
    p.stdin.end(JSON.stringify(event))
  })
}

test("Testdaten vorhanden", () => {
  const names = new Set(events.map(e => e.event.hook_event_name))
  for (const name of ["SessionStart", "UserPromptSubmit", "PreToolUse", "PostToolUse", "PermissionRequest", "Stop", "SessionEnd"])
    assert.ok(names.has(name), name + " fehlt in tests/fixtures")
  const asked = new Set(events.filter(e => e.event.hook_event_name === "PermissionRequest").map(e => e.event.tool_name))
  for (const tool of ["Bash", "AskUserQuestion", "ExitPlanMode"]) assert.ok(asked.has(tool), tool + "-Anfrage fehlt")
})

test("Felder, die der Hook liest, gibt es noch", () => {
  for (const { file, event } of events) {
    assert.equal(typeof event.session_id, "string", file + ": session_id")
    assert.equal(typeof event.hook_event_name, "string", file + ": hook_event_name")
    if (event.hook_event_name !== "SessionEnd") assert.equal(typeof event.cwd, "string", file + ": cwd")
    if (event.hook_event_name === "UserPromptSubmit") assert.equal(typeof event.prompt, "string", file + ": prompt")
    if (event.hook_event_name === "PermissionRequest") {
      assert.equal(typeof event.tool_name, "string", file + ": tool_name")
      assert.equal(typeof event.tool_input, "object", file + ": tool_input")
      // Questions and plans come without suggestions.
      if (!["AskUserQuestion", "ExitPlanMode"].includes(event.tool_name))
        assert.ok(Array.isArray(event.permission_suggestions), file + ": permission_suggestions")
      if (event.agent_id) assert.equal(typeof event.agent_type, "string", file + ": agent_type")
    }
    if (event.hook_event_name === "PreToolUse" || /^PostToolUse/.test(event.hook_event_name))
      assert.equal(typeof event.tool_use_id, "string", file + ": tool_use_id")
    if (event.hook_event_name === "PermissionRequest" && event.tool_name === "AskUserQuestion") {
      const q = event.tool_input.questions[0]
      assert.equal(typeof q.question, "string", file + ": questions[].question")
      assert.equal(typeof q.multiSelect, "boolean", file + ": questions[].multiSelect")
      assert.equal(typeof q.options[0].label, "string", file + ": questions[].options[].label")
    }
    if (event.hook_event_name === "PermissionRequest" && event.tool_name === "ExitPlanMode")
      assert.ok(typeof event.tool_input.plan === "string" || typeof event.tool_input.planFilePath === "string",
                file + ": plan oder planFilePath")
  }
})

test("Codex-Testdaten vorhanden, Felder wie erwartet", () => {
  const names = new Set(codexEvents.map(e => e.event.hook_event_name))
  for (const name of ["SessionStart", "UserPromptSubmit", "PreToolUse", "PostToolUse", "PermissionRequest", "Stop", "Interrupt", "SessionEnd"])
    assert.ok(names.has(name), name + " fehlt in tests/fixtures/codex-events")
  for (const { file, event } of codexEvents) {
    assert.equal(typeof event.session_id, "string", file + ": session_id")
    assert.equal(typeof event.cwd, "string", file + ": cwd")
    if (event.tool_name) assert.equal(typeof event.tool_input.command, "string", file + ": tool_input.command")
    if (event.hook_event_name === "PreToolUse" || event.hook_event_name === "PostToolUse")
      assert.equal(typeof event.tool_use_id, "string", file + ": tool_use_id")
  }
  const tools = new Set(codexEvents.filter(e => e.event.hook_event_name === "PermissionRequest").map(e => e.event.tool_name))
  for (const tool of ["Bash", "apply_patch"]) assert.ok(tools.has(tool), tool + "-Anfrage fehlt")
})

for (const [agent, list, args] of [["claude", events, []], ["codex", codexEvents, ["--codex"]]])
test("Der Hook verarbeitet die Sitzung von Anfang bis Ende (" + agent + ")", async (t) => {
  let asked = false
  for (const { file, event } of list) {
    const sid = event.session_id
    const name = event.hook_event_name
    await t.test(file, async () => {
      if (name === "PermissionRequest") {
        const { code, out, request } = await askAndAllow(event, args)
        assert.equal(code, 0)
        assert.ok(request, "Anfrage erscheint in state.json")
        assert.equal(request.tool, event.tool_name)
        assert.ok(request.detail !== "", "Kurztext")
        if (event.tool_name === "apply_patch") {
          assert.equal(request.detail, "farben.txt")
          // The diff (#128): the patch as old/new per file.
          assert.deepEqual(request.edits, [{ file: path.join(event.cwd, "farben.txt"), old: "", new: "rot\nblau", created: true }])
        }
        // Codex knows allow and deny only, anything more fails closed.
        if (agent === "codex") assert.deepEqual(JSON.parse(out).hookSpecificOutput.decision, { behavior: "allow" })
        if (event.tool_input.command) assert.equal(request.full, event.tool_input.command.trim())
        assert.equal(request.agent, event.agent_type || (event.agent_id ? "Subagent" : ""))
        const decision = JSON.parse(out).hookSpecificOutput.decision
        assert.equal(decision.behavior, "allow")
        if (event.tool_name === "AskUserQuestion") {
          assert.equal(request.kind, "question")
          assert.deepEqual(Object.keys(decision.updatedInput.answers), event.tool_input.questions.map(q => q.question))
        } else if (event.tool_name === "ExitPlanMode") {
          assert.equal(request.kind, "plan")
          assert.ok(request.full.length > 0, "Plantext")
          assert.equal(decision.updatedPermissions[0].mode, "auto")
        } else assert.equal(request.kind, "permission")
        // What the island makes of it.
        const ask = { key: "k", session: {}, request: SessionLogic.parseRequests([request])[0] }
        assert.ok(SessionLogic.askText(ask) !== "")
        assert.equal(state()[sid].state, "working")
        asked = true
        return
      }
      const before = state()[sid]
      const r = spawnSync(HOOK, args, { env, input: JSON.stringify(event), encoding: "utf8", timeout: 10000 })
      assert.equal(r.status, 0)
      assert.equal(r.stdout, "")
      const s = state()[sid]
      if (s) assert.equal(s.agent, agent)
      if (name === "SessionStart") assert.equal(s.state, "idle")
      else if (name === "UserPromptSubmit") {
        assert.equal(s.state, "working")
        // Harness messages (<task-notification> …) are not the user's prompt.
        if (!event.prompt.startsWith("<")) {
          const prompt = event.prompt.split(/\s+/).join(" ")
          if (prompt.length <= 120) assert.equal(s.prompt, prompt)
          else assert.ok(s.prompt.length <= 120 && s.prompt.endsWith("…") && prompt.startsWith(s.prompt.slice(0, -1)), "am Wortende gekürzt")
        }
      } else if (name === "PreToolUse") {
        const ids = (s.running || []).map(r => r.id)
        if (["AskUserQuestion", "ExitPlanMode"].includes(event.tool_name)) assert.ok(!ids.includes(event.tool_use_id))
        else assert.ok(ids.includes(event.tool_use_id), "läuft")
      } else if (name === "PostToolUse" || name === "PostToolUseFailure") {
        assert.equal(s.state, "working")
        assert.ok(!(s.running || []).some(r => r.id === event.tool_use_id), "läuft nicht mehr")
      }
      else if (name === "Stop") assert.equal(s.state, "done")
      else if (name === "Interrupt") assert.deepEqual([s.state, s.running], ["interrupted", []])
      else if (name === "SessionEnd") assert.equal(s, undefined)
      else assert.deepEqual(s, before, name + " ändert nichts")
      // What the island reads from it.
      const sessions = SessionLogic.parseSessions(fs.readFileSync(STATE, "utf8"))
      if (s) assert.equal(sessions.find(x => x.id === sid).name, path.basename(event.cwd || s.cwd))
      if (s) assert.equal(sessions.find(x => x.id === sid).agent, agent)
    })
  }
  assert.ok(asked, "mindestens eine Freigabe")
})

const expected = {
  SessionStart: "idle", BeforeAgent: "working", UserPromptSubmit: "working", TurnStart: "working",
  BeforeTool: "working", PreToolUse: "working", Notification: "needs", PermissionRequest: "needs",
  AfterTool: "working", PostToolUse: "working", PostToolUseFailure: "working", PermissionResult: "working",
  AfterAgent: "done", TurnEnd: "done", Stop: "done", SessionEnd: undefined,
  session_start: "idle", before_agent_start: "working", tool_execution_start: "working", tool_execution_end: "working",
  tool_approval_requested: "needs", tool_approval_resolved: "working", agent_end: "done", agent_settled: "done",
  session_shutdown: undefined,
}
// Pi's run can go on after agent_end (a retry); only agent_settled ends it.
const expectedFor = { "pi-agent": { agent_end: "working" } }
const ends = /^(SessionEnd|session_shutdown)$/

for (const { agent, args, extra, list } of otherEvents)
test("Der Hook verarbeitet die Sitzung von Anfang bis Ende (" + agent + ")", async (t) => {
  const names = list.map(e => e.event.hook_event_name)
  assert.ok(names.some(n => ends.test(n)) && (agent === "pi-agent" || names.some(n => expected[n] === "needs")),
            "mit Freigabe (Pi fragt nie) und Ende")
  let ended = false
  for (const { file, event } of list) {
    await t.test(file, async () => {
      const name = event.hook_event_name
      const sid = event.session_id
      const r = spawnSync(HOOK, args, { env: Object.assign({}, env, extra), input: JSON.stringify(event), encoding: "utf8", timeout: 10000 })
      assert.equal(r.status, 0)
      assert.equal(r.stdout, "", "nichts für den Agent")
      if (name === "Stop" && ended) {  // Grok's Stop "shutdown" after SessionEnd
        await sleep(300)
        assert.equal(state()[sid], undefined, "kommt nicht zurück")
        return
      }
      const want = name in (expectedFor[agent] || {}) ? expectedFor[agent][name] : expected[name]
      const tool = /^(BeforeTool|PreToolUse|tool_execution_start)$/.test(name)
      const check = s => ends.test(name) ? s === undefined
        : !!s && s.state === want && (!tool || (s.running || []).some(x => x.tool === "Bash"))
      await until(() => check(state()[sid]))
      const s = state()[sid]
      if (ends.test(name)) { assert.equal(s, undefined); ended = true; return }
      assert.equal(s.agent, agent)
      assert.equal(s.state, want, name)
      if (want === "needs") assert.ok(s.detail !== "" && !/Tool|permission/.test(s.detail), "was gefragt ist: " + s.detail)
      if (tool) assert.equal(s.running.slice(-1)[0].tool, "Bash")
      if (/^(BeforeAgent|UserPromptSubmit|before_agent_start)$/.test(name)) assert.equal(s.prompt, event.prompt)
      const island = SessionLogic.parseSessions(fs.readFileSync(STATE, "utf8")).find(x => x.id === sid)
      assert.equal(island.agent, agent)
      assert.notEqual(SessionLogic.agentName(island.agent), "Claude")
    })
  }
})

// opencode (#142): what agent-plugins/opencode.js handed the hook. The first
// approval the island answers with "Always" (the plugin replies "always":
// a decision with updatedPermissions), the second the user answers in the
// terminal (the plugin ends the waiting hook, then permission.replied).
const opencodeEvents = fs.readdirSync(path.join(FIXTURES, "opencode-events")).filter(f => f.endsWith(".json")).sort()
  .map(f => ({ file: f, event: JSON.parse(fs.readFileSync(path.join(FIXTURES, "opencode-events", f), "utf8")) }))
test("Der Hook verarbeitet die Sitzung von Anfang bis Ende (opencode)", async (t) => {
  const want = { "session.created": "idle", "session.execution.started": "working", "session.tool.called": "working",
                 "permission.asked": "needs", "permission.replied": "working", "session.tool.success": "working",
                 "session.execution.succeeded": "done" }
  let asked = 0
  for (const { file, event } of opencodeEvents) {
    await t.test(file, async () => {
      const name = event.hook_event_name
      const sid = event.session_id
      if (name === "permission.asked") {
        islandAlive()
        const p = spawn(HOOK, ["--agent", "opencode"], { env })
        let out = ""
        p.stdout.on("data", d => { out += d })
        const closed = new Promise(r => p.on("close", r))
        p.stdin.end(JSON.stringify(event))
        assert.ok(await until(() => (state()[sid] || {}).requests), "Anfrage in der Insel")
        const s = state()[sid]
        const request = s.requests[0]
        assert.equal(s.state, "needs")
        assert.equal(request.tool, "Bash")
        assert.equal(request.detail, event.tool_input.command)
        assert.equal(request.always, "shell(" + event.permission_suggestions[0].rules[0].ruleContent + ") – dieses Projekt")
        if (asked++ === 0) {
          spawnSync(HOOK, ["--decide", sid, request.id, "always"], { env })
          await closed
          const decision = JSON.parse(out).hookSpecificOutput.decision
          assert.equal(decision.behavior, "allow")
          assert.ok(decision.updatedPermissions, "„Immer“ für das Plugin erkennbar")
        } else {
          p.kill()
          await closed
          assert.equal(out, "", "im Terminal beantwortet: keine Antwort")
        }
        assert.equal(state()[sid].requests, undefined)
        return
      }
      const r = spawnSync(HOOK, ["--agent", "opencode"], { env, input: JSON.stringify(event), encoding: "utf8", timeout: 10000 })
      assert.equal(r.status, 0)
      assert.equal(r.stdout, "")
      const s = state()[sid]
      assert.equal(s.agent, "opencode")
      assert.equal(s.state, want[name], name)
      if (name === "session.tool.called") assert.equal(s.running.slice(-1)[0].tool, "Bash")
      if (name === "session.execution.started") assert.equal(s.prompt, event.prompt)
    })
  }
  assert.equal(asked, 2)
  const sid = opencodeEvents[0].event.session_id
  spawnSync(HOOK, ["--agent", "opencode"], { env, input: JSON.stringify({ hook_event_name: "session.deleted", session_id: sid }) })
  assert.equal(state()[sid], undefined, "gelöschte Sitzung ist weg")
})

// Async hooks arrive out of order, and Escape fires no hook at all: the
// recorded events, rearranged, in a session of their own.
test("Spätes PostToolUse nach Stop und Abbruch mit Escape", () => {
  const first = name => events.find(e => e.event.hook_event_name === name).event
  const post = events.find(e => e.event.hook_event_name === "PostToolUse").event
  const pre = events.find(e => e.event.hook_event_name === "PreToolUse" && e.event.tool_use_id === post.tool_use_id).event
  const send = (event, sid) => {
    const r = spawnSync(HOOK, [], { env, input: JSON.stringify(Object.assign({}, event, { session_id: sid })), encoding: "utf8" })
    assert.equal(r.status, 0)
  }
  const island = (sid, now) => {
    const s = SessionLogic.parseSessions(fs.readFileSync(STATE, "utf8")).find(x => x.id === sid)
    return SessionLogic.stateOf(s, now)
  }
  for (const e of [first("UserPromptSubmit"), pre, first("Stop"), post]) send(e, "late")
  assert.equal(state().late.state, "done", "fertig bleibt fertig")

  // Escape while a tool runs: the PreToolUse is the last thing that comes.
  for (const e of [first("UserPromptSubmit"), pre]) send(e, "escape")
  const now = Date.now() / 1000
  assert.equal(island("escape", now + 170), "working")
  assert.equal(island("escape", now + 190), "stale")
  for (const sid of ["late", "escape"]) send(first("SessionEnd"), sid)
})

test("Statuszeile: Limits und Kontext aus der echten Eingabe", () => {
  const r = spawnSync(STATUSLINE, [], { env, input: JSON.stringify(statusLine), encoding: "utf8", timeout: 10000 })
  assert.equal(r.status, 0)
  const raw = fs.readFileSync(path.join(tmp, "omarchy-buddy", "usage.json"), "utf8")
  const usage = SessionLogic.parseUsage(raw)
  // The limits are for the warning and "frei ab" (the hook), the island no longer shows them.
  if (statusLine.rate_limits && statusLine.rate_limits.five_hour) {
    const five = JSON.parse(raw).limits.five_hour
    assert.equal(five.used, statusLine.rate_limits.five_hour.used_percentage)
    assert.ok(five.resets > 1.7e9, "resets_at in Sekunden")
  }
  assert.equal(usage.sessions[statusLine.session_id].context, Math.round(statusLine.context_window.used_percentage))
})
