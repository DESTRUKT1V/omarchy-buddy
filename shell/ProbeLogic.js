.pragma library

// The test IPC (Probe.qml, target "omarchy-buddy.test") that tests/live
// and tests/gallery read the island through: what the island shows, as
// plain JSON, and which notifications belong to a test. Pure functions (no
// Quickshell, no QML), so tests/*.test.js can load this file in Node.
//
// Tests send their notifications under the app name testApp, their
// omarchy-buddy-say items and fake sessions under keys starting with testKey.
// Everything the test IPC changes only ever touches those (allows, below),
// and a test run stops when something real gets in the way (interruption).

var testApp = "Buddy-Test"
var testKey = "buddy-test-"  // lib/buddy.py TEST_KEY
var noteLimit = 15  // newest history records in a snapshot

// A test's key; "done-<session>-…" is the hook's pop-up for a finished test session (lib/hook.py report_done).
function isTestKey(key) { return new RegExp("^(done-)?" + testKey).test(String(key || "")) }

// A test's notification, pop-up or news item; a summary pop-up only when
// everything it folds is (ToastLogic.summaryToast's `testOnly`).
function isTest(item) {
  if (!item) return false
  if (item.app === testApp || isTestKey(item.key)) return true
  return item.testOnly === true
}

function isSession(o) { return !!o && typeof o.id === "string" && Array.isArray(o.requests) }
function isRecord(o) { return !!o && typeof o.key === "string" && o.key !== "" && o.time !== undefined }

// Whose thing a clickable (or text field) acts on, from its parents upward,
// nearest first. Probe.qml reads each level as {marker (probeOwner), ask,
// session, note, model (modelData)}. The answer: {kind: "session", id},
// {kind: "note", id, item}, {kind: "history" | "view" | "player"} (marked
// parts) or {kind: "none"}.
function owner(levels) {
  for (var i = 0; i < levels.length; i++) {
    var l = levels[i]
    if (l.marker) return { kind: String(l.marker) }
    var s = l.ask && l.ask.session && l.ask.session.id ? l.ask.session : l.session && l.session.id ? l.session : isSession(l.model) ? l.model : null
    if (s) return { kind: "session", id: String(s.id) }
    var n = isRecord(l.note) ? l.note : isRecord(l.model) ? l.model : null
    if (n) return { kind: "note", id: n.key, item: n }
  }
  return { kind: "none" }
}

// May the test act on owner o? want: what the test means (a session id, a
// record key, or "history", "view", "player"). c: {notes, removed, canUndo
// (the history's link undoes), testPlayer}. Unknown owners never.
function allows(o, want, c) {
  if (o.kind === "session") return o.id === want && isTestKey(o.id)
  if (o.kind === "note") return o.id === want && isTest(o.item)  // its whole bundle goes with it (×)
    && c.notes.every(function(n) { return n.group !== o.item.group || isTest(n) })
  if (o.kind === "history") return want === "history" && (c.canUndo ? c.removed : c.notes).every(isTest)
  if (o.kind === "player") return want === "player" && c.testPlayer === true
  return o.kind === "view" && want === "view"
}

// What Omarchy's "notifications" IPC method would act on (Notifications.qml),
// null for a method the test may not call.
function omarchyTargets(method, s) {
  var shown = s.mode === "toast" && s.toast ? [s.toast] : []
  if (["dismissOne", "invokeLast", "act", "invokeAction", "keyboard"].indexOf(method) !== -1) return shown
  if (method === "dismissAll" || method === "dismiss") return (s.toast ? [s.toast] : []).concat(s.queue)
  if (method === "showHistory") return []
  return null
}

// The real records (history, news) there are, by key (or time, a news item may have none) → true.
function recordId(r) { return String(r.key || r.time) }
function realKeys(records) {
  var keys = {}
  for (var i = 0; i < records.length; i++) if (!isTest(records[i])) keys[recordId(records[i])] = true
  return keys
}

// Why a test run has to stop, "" while nothing real is in the way: a real
// request waits, a real pop-up shows or waits, a real record came in since
// the start (`known`, also a silent one: Ruhemodus, sharing), the user opened
// the view or the settings page (not the test), or is away (pop-ups wait for them).
function interruption(s) {
  if (s.asks.some(function(a) { return !isTestKey(a && a.session && a.session.id) })) return "ask"
  if ((s.toast ? [s.toast] : []).concat(s.queue, s.heldBack).some(function(t) { return !isTest(t) })) return "popup"
  if (s.known && s.records.some(function(r) { return !isTest(r) && !s.known[recordId(r)] })) return "popup"
  if ((s.opened && !s.viewByTest) || (s.settingsShown && !s.settingsByTest)) return "view"
  return s.paused ? "away" : ""
}

function toastBrief(t) {
  if (!t) return null
  return { title: String(t.title || ""), body: String(t.body || ""), app: String(t.app || ""),
           source: String(t.source || ""), key: String(t.key || ""), count: t.count || 1,
           sticky: t.sticky === true, note: t.note === true, kind: String(t.kind || "") }
}

function noteBrief(n, live) {
  var actions = []
  for (var i = 0; i < (n.actions || []).length; i++) actions.push(n.actions[i].id)
  return { key: n.key, app: n.app, summary: n.summary, body: n.body, urgency: n.urgency,
           time: n.time, actions: actions, reply: n.reply === true, live: live === true, kind: String(n.kind || ""),
           commands: (n.execActions || []).map(function(c) { return c.label }) }
}

function askBrief(a) {
  if (!a) return null
  var r = a.request || {}
  return { session: String(a.session && a.session.id || ""), request: String(r.id || ""),
           tool: String(r.tool || ""), detail: String(r.detail || ""), kind: String(r.kind || ""),
           truncated: r.truncated === true, questions: (r.questions || []).length }
}

// Everything a test asks about, in one object. `s` holds the island's
// parts as Probe.qml reads them; live(key) says whether a record's live
// object (actions, reply) is still there.
function snapshot(s, live) {
  var notes = []
  for (var i = 0; i < s.notes.length && i < noteLimit; i++) notes.push(noteBrief(s.notes[i], live(s.notes[i].key)))
  return { mode: s.mode, emote: s.emote || "", opened: s.opened, peeking: s.peeking, quiet: s.quiet, sharing: s.sharing,
           silent: s.silent, veiled: s.veiled === true, settingsShown: s.settingsShown === true,
           settings: s.settings || null, settingsBroken: s.settingsBroken === true, settingsInvalid: s.settingsInvalid || [], away: s.away, fullscreen: s.fullscreen, paused: s.paused,
           toast: toastBrief(s.toast), queue: s.queue.map(toastBrief), heldBack: s.heldBack.length,
           notes: notes, noteCount: s.notes.length, realNotes: s.notes.filter(function(n) { return !isTest(n) }).length, ask: askBrief(s.ask), asks: s.asks.length,
           sessions: s.sessions.length, player: s.player || null, spotify: s.spotify || null,
           news: (s.news || []).slice(0, noteLimit).map(function(i) { return String(i.title || "") }) }
}

// The test's record with this key, or null (others are never touched).
function testNote(notes, key) {
  for (var i = 0; i < notes.length; i++)
    if (notes[i].key === key) return isTest(notes[i]) ? notes[i] : null
  return null
}

// The bundles (groups) the test's records sit in, each once.
function testGroups(notes) {
  var groups = []
  for (var i = 0; i < notes.length; i++)
    if (isTest(notes[i]) && groups.indexOf(notes[i].group) === -1) groups.push(notes[i].group)
  return groups
}

// Can a clickable thing be reached? It has to lie inside every clipping
// parent (innermost first, the island and the window last), or inside a
// Flickable that scrolls: then it can be scrolled into that one's view, and
// that whole view has to be visible (the end of the content shows at its bottom).
// Rects are {x, y, w, h} in one coordinate system; 1 px of rounding is fine.
function inside(r, c) {
  return r.x >= c.x - 1 && r.y >= c.y - 1 && r.x + r.w <= c.x + c.w + 1 && r.y + r.h <= c.y + c.h + 1
}

function reachable(rect, clips) {
  var r = rect
  for (var i = 0; i < clips.length; i++) {
    var c = clips[i].rect
    if (inside(r, c)) continue
    var across = r.x >= c.x - 1 && r.x + r.w <= c.x + c.w + 1
    if (!clips[i].flick || !clips[i].interactive || !across) return false
    r = { x: r.x, y: c.y, w: r.w, h: c.h }
  }
  return true
}

// What Probe.layout() returns: every clickable thing with `reach`, and the
// names of those that cannot be reached.
function layout(raw) {
  var items = raw.items.map(function(it) {
    return { name: it.name, enabled: it.enabled, x: it.rect.x, y: it.rect.y, w: it.rect.w, h: it.rect.h,
             truncated: it.truncated, reach: reachable(it.rect, it.clips) }
  })
  return { mode: raw.mode, island: raw.island, window: raw.window, items: items, flicks: raw.flicks,
           unreachable: items.filter(function(it) { return !it.reach }).map(function(it) { return it.name }) }
}
