.pragma library
.import "Strings.js" as Strings

// Claude and Codex sessions as omarchy-buddy-hook writes them to
// state.json: reading the file and what state a session is in right now. Pure functions (no
// Quickshell, no QML), so tests/*.test.js can load this file in Node.

var stateOrder = { needs: 0, done: 1, asked: 2, working: 3, stale: 4, interrupted: 5, idle: 6 }

// The agents the hook knows (its "agent" field): name and mark (Nerd Font
// glyph; Codicons cod-claude, cod-openai, cod-copilot, Material
// star-four-points, candy, alpha-x and cursor-default for Gemini, Crush,
// Grok and Cursor). A further agent needs a row here (its key as Omarchy names it),
// the hook's translation of its events (OTHER_AGENTS) and its source in
// omarchy-buddy-say. Records from before #130
// have no agent: Claude.
var agents = {
  claude: { name: "Claude", mark: "\uec82" },
  codex: { name: "Codex", mark: "\uec81" },
  gemini: { name: "Gemini", mark: "\udb82\udee2" },
  crush: { name: "Crush", mark: "\udb86\udd70" },
  grok: { name: "Grok", mark: "\udb82\udf05" },
  "cursor-agent": { name: "Cursor", mark: "\udb80\uddc0" },
  copilot: { name: "Copilot", mark: "\uec1e" },
  // (#142, Material code-braces, pi, pi-box)
  opencode: { name: "opencode", mark: "\udb80\udd69" },
  "pi-agent": { name: "Pi", mark: "\udb80\udfff" },
  omp: { name: "Oh My Pi", mark: "\udb81\udc00" },
  // (#145, Omarchy 4.5; Material rocket-launch, alpha-q-box, moon-waning-crescent,
  // alpha-d-box, console-line, ghost)
  agy: { name: "Antigravity", mark: "\udb85\udcde" },
  qwen: { name: "Qwen Code", mark: "\udb82\udf18" },
  kimi: { name: "Kimi", mark: "\udb83\udf65" },
  devin: { name: "Devin", mark: "\udb82\udf0b" },
  commandcode: { name: "Command Code", mark: "\udb81\udfb7" },
  "kiro-cli": { name: "Kiro", mark: "\udb80\udea0" },
  // (#144, Material alpha-m-box)
  muse: { name: "Muse", mark: "\udb82\udf14" },
}

function agentOf(value) { return agents[value] ? value : "claude" }

// Until the first session came (#192) the "Agents" section says how one
// comes and lists the agents found (omarchy-buddy-setup --agents, one per
// line) in this order, without names the island does not know.
function foundAgents(installed) {
  var have = String(installed || "").split("\n").map(function(a) { return a.trim() })
  return Object.keys(agents).filter(function(a) { return have.indexOf(a) !== -1 })
    .map(function(a) { return { id: a, name: agents[a].name, mark: agents[a].mark } })
}
function agentName(agent) { return agents[agentOf(agent)].name }
function agentMark(agent) { return agents[agentOf(agent)].mark }

// Omarchy's default agent (~/.config/omarchy/defaults/agent, as
// omarchy-default-agent writes it) → its name, "" when none is set. An agent
// the island does not know keeps Omarchy's word for it ("opencode").
function defaultAgentName(raw) {
  var agent = String(raw || "").split("\n")[0].trim()
  return agents[agent] ? agents[agent].name : agent
}

// state.json text → session records, the most urgent first (as of `now`).
function parseSessions(raw, now) {
  var data = {}
  try { data = JSON.parse(String(raw || "{}")) } catch (e) { data = {} }
  if (!data || typeof data !== "object" || Array.isArray(data)) data = {}
  var list = []
  for (var id in data) {
    var s = data[id] || {}
    var cwd = String(s.cwd || ""), agent = agentOf(s.agent)
    list.push({ id: id, state: String(s.state || "idle"), cwd: cwd, agent: agent,
                name: cwd.replace(/\/+$/, "").split("/").pop() || cwd || agentName(agent),
                tool: String(s.tool || ""), detail: String(s.detail || ""),
                prompt: String(s.prompt || ""), error: s.error === true, errorText: String(s.error_text || ""),
                running: parseRunning(s.running), orca: s.orca === true,
                orca_terminal: String(s.orca_terminal || ""), orca_pane: String(s.orca_pane || ""),
                requests: parseRequests(s.requests), window: String(s.window || ""),
                pid: Number(s.pid || 0), origin: String(s.origin || ""),
                updated: Number(s.updated || 0), since: Number(s.since || 0) })
  }
  return sortSessions(list, now)
}

// The most urgent first, by the state a session is in right now (a request
// that ran out, a run gone quiet); within a state the one waiting longest.
function sortSessions(list, now) {
  return list.slice().sort(function(a, b) {
    return (stateOrder[stateOf(a, now)] - stateOrder[stateOf(b, now)]) || (a.updated - b.updated)
  })
}

function sameOrder(a, b) {
  if (a.length !== b.length) return false
  for (var i = 0; i < a.length; i++) if (a[i].id !== b[i].id) return false
  return true
}

// kind: "permission" (allow / always / deny), "question" (AskUserQuestion:
// questions with options) or "plan" (ExitPlanMode: full is the plan).
// edits: a file change for the diff (DiffLogic), null for other tools.
function parseRequests(list) {
  if (!Array.isArray(list)) return []
  return list.map(function(r) {
    r = r || {}
    var kind = r.kind === "question" || r.kind === "plan" ? r.kind : "permission"
    return { id: String(r.id || ""), kind: kind, tool: String(r.tool || ""), detail: String(r.detail || ""),
             full: String(r.full || r.detail || ""), always: String(r.always || ""),
             description: String(r.description || ""),
             agent: String(r.agent || ""), until: Number(r.until || 0), wait: Number(r.wait || 30),
             truncated: r.truncated === true,
             edits: kind === "permission" && Array.isArray(r.edits) ? r.edits : null, editsCut: r.edits_cut === true,
             questions: kind === "question" ? parseQuestions(r.questions) : [] }
  })
}

function parseQuestions(list) {
  if (!Array.isArray(list)) return []
  var result = []
  for (var i = 0; i < list.length; i++) {
    var q = list[i] || {}
    if (!q.question) continue
    var options = Array.isArray(q.options) ? q.options : []
    result.push({ question: String(q.question), header: String(q.header || ""), multiSelect: q.multiSelect === true,
                  options: options.filter(function(o) { return o && o.label })
                    .map(function(o) { return { label: String(o.label), description: String(o.description || "") } }) })
  }
  return result
}

// The tools a session runs right now, oldest first (omarchy-buddy-hook keeps
// them from PreToolUse to PostToolUse); timeout: the tool's own, in seconds
// (0: none given).
function parseRunning(list) {
  if (!Array.isArray(list)) return []
  return list.map(function(r) {
    r = r || {}
    return { id: String(r.id || ""), tool: String(r.tool || ""), detail: String(r.detail || ""),
             agent: String(r.agent || ""), at: Number(r.at || 0), timeout: Number(r.timeout) || 0 }
  })
}

// Requests whose hook still waits; the deadline covers a hook that died
// before it could clean up (--prune removes those for good).
function liveRequests(s, now) {
  return s.requests.filter(function(r) { return r.until > now })
}

// How long a working session may go without a hook event. Escape fires
// no hook at all (no Stop, no PostToolUse, no idle_prompt), so silence is
// the only sign of it. Claude rarely goes three minutes without one; a
// tool with a longer timeout (Bash up to 10 min) gets its timeout plus a
// minute.
function quietLimit(s) {
  var limit = 180
  for (var i = 0; i < s.running.length; i++) limit = Math.max(limit, s.running[i].timeout + 60)
  return limit
}

// A working session that went quiet was most likely interrupted
// (quietLimit); "fertig" fades to "bereit" after ten minutes. Codex says
// when it was interrupted ("interrupted", until the next prompt).
// An open request always counts. A terminal prompt with no hook event for
// two minutes was most likely answered there (denied, Escape): it leaves
// the alarm and only stays in the list as "asked".
function stateOf(s, now) {
  if (liveRequests(s, now).length) return "needs"
  if (s.state === "needs" && now - s.updated > 120) return "asked"
  if (s.state === "working" && now - s.updated > quietLimit(s)) return "stale"
  if (s.state === "done" && now - s.updated > 600) return "idle"
  return s.state
}

// The card's second line, a sentence with the agent (#193, no "Codex · arbeitet").
function stateText(s, now, lang) {
  var st = stateOf(s, now), name = agentName(s.agent)
  if (st === "stale") return Strings.tl(lang, "state.stale", name, Math.round((now - s.updated) / 60))
  if (s.error && st === "done") return Strings.tl(lang, "state.error", name, s.errorText || Strings.tl(lang, "state.apiError"))
  return Strings.hasIn(lang, "state." + st) ? Strings.tl(lang, "state." + st, name) : name + ": " + st
}

// Sessions without a hook event for 30 minutes leave the list, and so do
// those the user hid (`hidden`: id → the session's `updated` when they hid it).
// An open request keeps them; the next hook event brings them back.
function shown(s, now, hidden) {
  if (liveRequests(s, now).length > 0) return true
  return now - s.updated <= 1800 && !(hidden && hidden[s.id] === s.updated)
}

// A long list folds: from the 8th shown session on, the finished and quiet
// ones (done, idle, stale) wait behind "+N more". → { id: true }
var foldFrom = 7
function folded(sessions, now, hidden) {
  var ids = {}, pos = 0
  for (var i = 0; i < sessions.length; i++) {
    if (!shown(sessions[i], now, hidden)) continue
    var st = stateOf(sessions[i], now)
    if (pos++ >= foldFrom && (st === "done" || st === "idle" || st === "stale" || st === "interrupted")) ids[sessions[i].id] = true
  }
  return ids
}

// The open view's "Für dich" block (#175) holds the sessions waiting for the
// user; the list below it the others. forYou: which of the two.
function forYouPart(sessions, now, forYou) {
  return sessions.filter(function(s) { return (stateOf(s, now) === "needs") === forYou })
}

function shownCount(sessions, now, hidden) {
  return sessions.filter(function(s) { return shown(s, now, hidden) }).length
}

// A session without a window the user can get to: one Claude's background
// service runs (claude --bg), or whose terminal window is gone. windows:
// the addresses Hyprland has now, with or without "0x"; an empty list says
// nothing (Hyprland not read yet). Orca sessions stay reachable, the hook
// brings up Orca and their pane.
function background(s, windows) {
  if (s.origin === "daemon") return true
  if (s.orca || !windows || !windows.length) return false
  var bare = s.window.replace(/^0x/, "")
  for (var i = 0; i < windows.length; i++) if (String(windows[i]).replace(/^0x/, "") === bare) return false
  return true
}

function backgroundCount(sessions, now, windows, hidden) {
  return sessions.filter(function(s) { return shown(s, now, hidden) && background(s, windows) }).length
}

// The user can end a session from the island when nothing else gets them to it.
function canEnd(s, windows) {
  return s.pid > 0 && background(s, windows)
}

// The question before the user ends a session from the island.
function endQuestion(s, now, lang) {
  return Strings.tl(lang, stateOf(s, now) === "working" ? "end.questionWorking" : "end.question", s.name, agentName(s.agent))
}

// The user hides a session's row (not one with an open request).
function canHide(s, now) { return liveRequests(s, now).length === 0 }

// The hidden ones that still matter: a session gone from state.json or
// with a newer hook event is shown again and leaves the list.
function hide(hidden, sessions, s) {
  var next = {}
  for (var i = 0; i < sessions.length; i++) {
    var id = sessions[i].id
    if (hidden[id] === sessions[i].updated) next[id] = hidden[id]
  }
  if (s) next[s.id] = s.updated
  return next
}

function count(sessions, state, now) {
  return sessions.filter(function(s) { return stateOf(s, now) === state }).length
}

// Something the island itself can answer (buttons, options): only that
// holds pop-ups back.
function answerable(asks) { return asks.some(function(a) { return !!a.request }) }

function hasRequests(sessions) { return sessions.some(function(s) { return s.requests.length > 0 }) }

// Omarchy's notifications.keyboard while something waits (#193, B10): the
// safe answer of the oldest request in the open view's list (Click.key of
// RequestButtons/QuestionPicker), so Enter never allows by accident.
// "" when no request waits; then the newest notification takes the keys.
function keyboardTarget(asks) {
  for (var i = 0; i < asks.length; i++) {
    var r = asks[i].request
    if (!r) continue
    if (r.kind === "plan") return "list|" + asks[i].key + "|revise"
    if (r.kind === "question") {
      var q = r.questions[0]
      return q && q.options.length ? "list|" + asks[i].key + "|" + q.question + "|" + q.options[0].label : ""
    }
    return "list|" + asks[i].key + "|deny"
  }
  return ""
}

// Everything waiting for the user, as a queue: one entry per open request
// (the island can answer it), oldest first, then one per session that asks
// in its terminal (request null).
function asks(sessions, now) {
  var list = [], terminal = []
  for (var i = 0; i < sessions.length; i++) {
    var s = sessions[i]
    if (stateOf(s, now) !== "needs") continue
    var live = liveRequests(s, now)
    if (!live.length) terminal.push({ key: s.id, session: s, request: null })
    for (var j = 0; j < live.length; j++) list.push({ key: s.id + "/" + live[j].id, session: s, request: live[j] })
  }
  list.sort(function(a, b) { return (a.request.until - a.request.wait) - (b.request.until - b.request.wait) })
  return list.concat(terminal)
}

// The ask the island keeps showing until it is done (or the user pages):
// a new event or request never makes it jump. A terminal question gives way
// to one the island can answer.
function shownKey(list, key) {
  for (var i = 0; i < list.length; i++)
    if (list[i].key === key && (list[i].request || !answerable(list))) return key
  return list.length ? list[0].key : ""
}

function askPos(list, key) {
  for (var i = 0; i < list.length; i++) if (list[i].key === key) return i
  return 0
}

// The ask `step` places further (wraps around), as its key.
function pagedKey(list, key, step) {
  if (list.length < 2) return key
  return list[(askPos(list, key) + step + list.length) % list.length].key
}

// The line under a session in the open view: what it asks in the
// terminal, otherwise the user's last prompt. Open requests show their own
// blocks instead.
function rowDetail(s, now, lang) {
  var st = stateOf(s, now)
  if (st === "needs" && liveRequests(s, now).length) return ""
  if (st === "needs" || st === "asked") return (s.tool ? s.tool + ": " : "") + s.detail
  return s.prompt !== "" ? Strings.tl(lang, "quote", s.prompt) : ""
}

// The short text of an ask: the request's command (the question, the
// plan's title), or what the session asks in its terminal.
function askText(ask, lang) {
  var r = ask && ask.request ? ask.request : null
  if (r && r.kind === "question") return r.detail
  if (r && r.kind === "plan") return Strings.tl(lang, "ask.plan", r.detail)
  if (r) return (r.tool ? r.tool + ": " : "") + r.detail
  var s = ask && ask.session
  return s && s.detail ? (s.tool ? s.tool + ": " : "") + s.detail : ""
}

// States that changed between two reads, and which sessions just finished.
function transitions(before, sessions) {
  var changed = false, finished = []
  for (var i = 0; i < sessions.length; i++) {
    var was = before[sessions[i].id]
    if (was === undefined || was === sessions[i].state) continue
    changed = true
    if (was !== "done" && sessions[i].state === "done") finished.push(sessions[i].id)
  }
  return { changed: changed, finished: finished }
}

function statesOf(sessions) {
  var states = {}
  for (var i = 0; i < sessions.length; i++) states[sessions[i].id] = sessions[i].state
  return states
}

// What the needs view says next to the session's name.
function askLabel(ask, lang) {
  var kind = ask && ask.request ? ask.request.kind : ""
  return Strings.tl(lang, kind === "question" ? "ask.question" : kind === "plan" ? "ask.planLabel" : "ask.needs")
}

// Answers to a question request, as chosen in the island so far:
// { "question text": ["label", …] }. A free text answer is a label of its own.
function chosen(sel, question, label) {
  var list = (sel || {})[question] || []
  return list.indexOf(label) !== -1
}

function toggleOption(sel, q, label) {
  var next = {}
  for (var k in sel || {}) next[k] = sel[k].slice()
  var list = next[q.question] || []
  if (!q.multiSelect) list = [label]
  else if (list.indexOf(label) !== -1) list = list.filter(function(l) { return l !== label })
  else list = list.concat([label])
  next[q.question] = list
  return next
}

// The user's own text instead of (or, with several allowed, next to) the options.
function setOwnAnswer(sel, q, text) {
  text = String(text || "").replace(/\s+/g, " ").trim()
  var labels = q.options.map(function(o) { return o.label })
  var next = toggleOption(sel, { question: q.question, multiSelect: true }, "")
  var kept = q.multiSelect ? (next[q.question] || []).filter(function(l) { return l && labels.indexOf(l) !== -1 }) : []
  next[q.question] = text ? kept.concat([text]) : kept
  return next
}

// The text the user typed for this question (an answer that is no option).
function ownAnswer(sel, q) {
  var labels = q.options.map(function(o) { return o.label })
  var list = (sel || {})[q.question] || []
  for (var i = 0; i < list.length; i++) if (labels.indexOf(list[i]) === -1) return list[i]
  return ""
}

// Whether an option row of question q shows its mark; label "" is the
// "Eigene Antwort" row. While its field is open (typingOwn) it is marked,
// and with one choice only the options it would replace are not.
function marked(sel, q, label, typingOwn) {
  if (label === "") return typingOwn || ownAnswer(sel, q) !== ""
  return chosen(sel, q.question, label) && !(typingOwn && !q.multiSelect)
}

function answersComplete(questions, sel) {
  if (!questions.length) return false
  for (var i = 0; i < questions.length; i++)
    if (!((sel || {})[questions[i].question] || []).length) return false
  return true
}

// Next to a greyed-out "Antworten": how many questions still lack an answer.
function openText(questions, sel, lang) {
  var open = 0
  for (var i = 0; i < questions.length; i++)
    if (!((sel || {})[questions[i].question] || []).length) open++
  return open === 0 ? "" : open === 1 ? Strings.tl(lang, "question.open.one") : Strings.tl(lang, "question.open.many", open)
}

// Markdown links in a plan as HTML links in the theme's color: Qt's markdown
// reader paints [text](url) in its own fixed blue, inline HTML keeps a color.
// Every image (inline, with title, reference style) becomes a link and the
// plan's own HTML tags plain text, so showing a plan never loads anything
// from the net. Code (spans, fences) stays as is: Qt shows it as text anyway.
function planLinks(text, color) {
  function esc(t) { return t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;") }
  function prose(t) {
    return t.replace(/!\[/g, "[").replace(/\[([^\]\n]*)\]\(([^)\s]+)\)|<(?=[A-Za-z\/!?])/g, function(all, label, url) {
      if (all === "<") return "&lt;"
      return '<a href="' + esc(url) + '" style="color:' + esc(String(color)) + '">' + esc(label || url) + "</a>"
    })
  }
  var fence = false
  return String(text || "").split("\n").map(function(line) {
    if (/^\s{0,3}(```|~~~)/.test(line)) { fence = !fence; return line }
    return fence ? line : line.split(/(`+[^`]*`+)/).map(function(part, i) { return i % 2 ? part : prose(part) }).join("")
  }).join("\n")
}

// One question with one choice: a click on an option answers right away.
function answersAtOnce(questions) {
  return questions.length === 1 && !questions[0].multiSelect
}

// What the hook hands to Claude: per question the labels in the options'
// order, the user's own text last, joined with ", " (as Claude's own dialog).
function answerPayload(questions, sel) {
  var payload = {}
  for (var i = 0; i < questions.length; i++) {
    var q = questions[i], list = (sel || {})[q.question] || []
    var labels = q.options.map(function(o) { return o.label })
    var ordered = labels.filter(function(l) { return list.indexOf(l) !== -1 })
      .concat(list.filter(function(l) { return labels.indexOf(l) === -1 }))
    if (ordered.length) payload[q.question] = ordered.join(", ")
  }
  return payload
}

// Ticker: what a working session does right now, in a few words.
// (the text key for each tool: Strings "tool.…"; Bash only shows "$ ";
// Codex's apply_patch: the hook writes its files)
var toolVerb = { Read: "Read", Edit: "Edit", MultiEdit: "Edit", Write: "Write", NotebookEdit: "Edit",
                 Grep: "Grep", Glob: "Grep", WebFetch: "WebFetch", WebSearch: "WebSearch",
                 Agent: "Agent", Task: "Agent", Skill: "Skill", apply_patch: "Edit" }

function verb(tool, lang) {
  return tool === "Bash" ? "$ " : toolVerb[tool] ? Strings.tl(lang, "tool." + toolVerb[tool]) : ""
}
var fileTools = { Read: true, Edit: true, MultiEdit: true, Write: true, NotebookEdit: true }

function toolText(r, lang) {
  if (!r) return ""
  var detail = r.detail
  if (fileTools[r.tool]) detail = detail.replace(/\/+$/, "").split("/").pop()
  var text
  if (verb(r.tool, lang) && detail) text = verb(r.tool, lang) + detail
  else if (/^mcp__/.test(r.tool)) text = r.tool.replace(/^mcp__/, "").replace(/__/, ": ") + (detail ? " " + detail : "")
  else text = r.tool + (detail ? ": " + detail : "")
  return text + (r.agent ? " (" + r.agent + ")" : "")  // the subagent after it, no "·" chain (#194)
}

// The newest tool a working session runs, or null.
function currentTool(s, now) {
  if (stateOf(s, now) !== "working" || !s.running.length) return null
  var newest = s.running[0]
  for (var i = 1; i < s.running.length; i++) if (s.running[i].at >= newest.at) newest = s.running[i]
  return newest
}

// The ticker's line for one session: its tool, or that it thinks.
function workText(s, now, lang) {
  var r = currentTool(s, now)
  return r ? toolText(r, lang) : Strings.tl(lang, "work.thinking")
}

// The ticker in pill and peek: the most recently busy working session,
// with its name when several work. "" when none works.
function ticker(sessions, now, hidden, lang) {
  var working = sessions.filter(function(s) { return stateOf(s, now) === "working" && shown(s, now, hidden) })
  if (!working.length) return ""
  var best = working[0], bestAt = -1
  for (var i = 0; i < working.length; i++) {
    var r = currentTool(working[i], now)
    var at = r ? r.at : working[i].updated
    if (at > bestAt) { best = working[i]; bestAt = at }
  }
  return (working.length > 1 ? best.name + ": " : "") + workText(best, now, lang)
}

// The mark for "braucht dich" in the pill: the agent of the ask shown first.
function needsMark(sessions, now) {
  var list = asks(sessions, now)
  return agentMark(list.length ? list[0].session.agent : "claude")
}

// The one working session's agent (summary "Codex arbeitet"); Claude when none or several.
function workingAgent(sessions, now) {
  var working = sessions.filter(function(s) { return stateOf(s, now) === "working" })
  return working.length === 1 ? working[0].agent : "claude"
}

// usage.json from omarchy-buddy-statusline: each session's context window.
// (The limits stay out of the island, Omarchy's Agents panel shows them.)
function parseUsage(raw) {
  var data = {}
  try { data = JSON.parse(String(raw || "{}")) } catch (e) { data = {} }
  if (!data || typeof data !== "object") data = {}
  var sessions = {}
  for (var id in data.sessions || {}) sessions[id] = { context: Number((data.sessions[id] || {}).context || 0) }
  return { sessions: sessions }
}

// How long the island can still answer a request: seconds under a minute,
// whole minutes from there on ("noch 5 min" for 302 s).
function countdownText(remaining, lang) {
  var s = Math.ceil(remaining)
  return s < 60 ? Strings.tl(lang, "countdown", s) : Strings.tl(lang, "countdown.min", Math.round(s / 60))
}

// A session's context window, once it is worth a look.
function contextText(usage, s, lang) {
  var u = usage.sessions[s.id]
  return u && u.context >= 60 ? Strings.tl(lang, "usage.context", Math.round(u.context)) : ""
}

// A plan for the island's small text: headings become bold lines of their
// own (two trailing spaces break the line); as markdown headings they would
// be far bigger than everything else. The empty line before one ends a list
// (otherwise the heading would join its last item).
function planMarkdown(text) {
  return String(text || "").split("\n").map(function(line, i) {
    var m = /^\s{0,3}#{1,6}\s+(.*?)\s*#*\s*$/.exec(line)
    return m ? (i > 0 ? "\n" : "") + "**" + m[1] + "**  " : line
  }).join("\n")
}
