.pragma library
.import "Strings.js" as Strings
.import "ProbeLogic.js" as ProbeLogic
.import "SessionLogic.js" as SessionLogic
.import "NoteLogic.js" as NoteLogic

// Pop-ups (toasts) and the news feed: which news items pop up, the flood
// guard that folds a long queue into one summary, and how long a pop-up
// stays. Pure functions (no Quickshell, no QML), so tests/*.test.js can
// load this file in Node; Toasts.qml and News.qml hold the state.

// Every list of pop-ups (waiting, held back) stays finite however long the
// user is away or the view stays open: at most maxLoose single ones plus one
// summary, at most maxSticky critical ones (the oldest beyond fold into one
// critical summary), a summary keeps maxNames names and the total as a
// number, and a pop-up's text is cut at NoteLogic.maxText.
var maxLoose = 3   // pop-ups waiting beyond this many fold into one summary
var maxSticky = 10
var maxNames = 4   // three are shown, the fourth says there are more (" …")

function countOf(items) {
  var n = 0
  for (var i = 0; i < items.length; i++) n += items[i].count || 1
  return n
}

function isProblem(level) { return level === "error" || level === "warn" }

function summaryToast(items, title, time) {
  var problem = items.some(function(t) { return isProblem(t.level) })
  // A summary folded into a new one passes on its names and its count.
  var names = []
  for (var j = 0; j < items.length && names.length < maxNames; j++) names = names.concat(items[j].names || [items[j].title])
  names = names.slice(0, maxNames)
  // testOnly: everything it folds is a test's (#256), so the test IPC knows its own summary;
  // a flag, not the list of senders, so a summary stays small however much it folds (#254).
  var testOnly = items.length > 0 && items.every(function(t) { return ProbeLogic.isTest(t) })
  return { time: time, source: "buddy", level: problem ? "warn" : "info", title: title,
           names: names, testOnly: testOnly, count: countOf(items), emote: strongest(items.map(emoteFor)),
           body: names.slice(0, 3).join(", ") + (names.length > 3 ? " …" : "") }
}

// O-Morchy's emotion when a pop-up appears (#177), "" for none (then it
// talks, or celebrates a finished agent run, as before). A summary carries
// the strongest of the ones it folds.
function emoteFor(toast) {
  if (!toast) return ""
  if (toast.emote) return toast.emote
  if (toast.source === "terminal") return toast.level === "good" ? "done" : toast.level === "error" ? "failed" : ""
  if (toast.source === "kuma") return toast.level === "good" ? "relief" : "outage"
  if (/^crash:/.test(String(toast.action || ""))) return "outage"
  return toast.note && { event: "alarm", mail: "mail", chat: "chat" }[toast.kind] || ""
}

// Several at once: the stronger one wins (a request before an outage before
// an appointment before the rest), an equal one starts anew, the weaker one
// is dropped; there is no queue. `playing` may be a gesture (wave, …): any
// emotion replaces it.
var emoteRank = { ask: 3, outage: 2, alarm: 1 }
function emoteWins(next, playing) { return (emoteRank[next] || 0) >= (emoteRank[playing] || 0) }

function strongest(list) {
  var best = ""
  for (var i = 0; i < list.length; i++) if (list[i] && emoteWins(list[i], best)) best = list[i]
  return best
}

// A letter or a speech bubble only on the pop-up's O-Morchy, never in the
// pill (which shows its own letter or bubble for an unread one).
function popupOnly(emote) { return emote === "mail" || emote === "chat" }

// Requests on screen (keys) against those O-Morchy already raised its hand
// for: true when one of them is new (paging or answering is not).
function newAsk(keys, greeted) {
  return keys.some(function(k) { return greeted.indexOf(k) === -1 })
}

// Flood guard: critical pop-ups ("sticky") go first and stay single up to
// maxSticky; beyond that the oldest become one critical "N kritische
// Meldungen", which stays until clicked away and survives a restart like
// them. Everything else waiting beyond three pop-ups becomes one
// "N Neuigkeiten".
function fold(queue, items, time, lang) {
  queue = queue.concat(items)
  var sticky = queue.filter(function(t) { return t.sticky })
  var loose = queue.filter(function(t) { return !t.sticky })
  if (sticky.length > maxSticky) {
    var old = sticky.slice(0, sticky.length - maxSticky + 1)
    var crit = summaryToast(old, Strings.tl(lang, "toast.critical", countOf(old)), time)
    crit.sticky = true
    crit.key = "buddy-critical:" + time + ":" + countOf(old)  // stickyOnes and restoreSticky go by key
    if (old.some(function(t) { return t.level === "error" })) crit.level = "error"
    sticky = [crit].concat(sticky.slice(old.length))
  }
  if (loose.length > maxLoose) loose = [summaryToast(loose, Strings.tl(lang, "toast.many", countOf(loose)), time)]
  return sticky.concat(loose)
}

// Admission while held back (user away, fullscreen, open view): the same
// bounds as fold, and fleeting ones go right away (bundle would drop them
// on the return anyway).
function hold(held, items, time, lang) {
  return fold(held.filter(function(t) { return !fleeting(t) }), items.filter(function(t) { return !fleeting(t) }), time, lang)
}

// Only worth something in the moment: volume and brightness, Omarchy's
// feedback ("Screenshot gespeichert"), transient ones and songs. Held back,
// they are stale by the time the user sees them.
function fleeting(toast) {
  return !toast.sticky && (!!toast.ephemeral || !!toast.media)
}

// Pop-ups held back: fleeting ones go, critical ones stay as they are, the
// rest as one summary when there is more than one (or the one is a summary
// already, folded by hold). prefix goes before "N Neuigkeiten".
function bundle(held, time, prefix, lang) {
  held = held.filter(function(t) { return !fleeting(t) })
  var sticky = held.filter(function(t) { return t.sticky })
  var loose = held.filter(function(t) { return !t.sticky })
  if (loose.length > 1 || (loose.length === 1 && loose[0].names)) loose = [summaryToast(loose, (prefix || "") + Strings.tl(lang, "toast.many", countOf(loose)), time)]
  return sticky.concat(loose)
}

// What the user gets on their return.
function welcomeBack(held, time, lang) { return bundle(held, time, Strings.tl(lang, "toast.away"), lang) }

// What came while the open view was open: after it closes.
function afterOpen(held, time, lang) { return bundle(held, time, "", lang) }

// News from an agent's session (omarchy-buddy-hook).
function agentSource(source) { return Object.prototype.hasOwnProperty.call(SessionLogic.agents, source) }

// A finished Claude run (or its error, a limit) stays until the user has
// touched mouse or keyboard after it appeared: "away" only starts after
// two minutes without input, and a run often ends in that gap.
function waitsForInput(toast) {
  return !!toast && agentSource(toast.source) && !toast.note
}

// Whether the pop-up on screen runs out (`waiting`: how many wait behind
// it). A critical one stays, and a finished run waits for input, but only
// while nothing else waits.
function runsOut(toast, waiting, inputSeen) {
  if (!toast) return false
  if (waiting > 0) return true
  return !toast.sticky && (inputSeen || !waitsForInput(toast))
}

// Its time is up: the next one comes. A critical one goes behind the others
// and comes back (`gone` is null then: it has not left).
function afterTime(toast, queue) {
  var rest = queue.slice(1)
  if (toast && toast.sticky) rest = rest.concat([toast])
  return { toast: queue.length ? queue[0] : null, queue: rest, gone: toast && !toast.sticky ? toast : null }
}

// Opening the view: the waiting ones are held back with what comes while it
// is open; the pop-up on screen has been seen and goes (`drop`), a critical
// one waits behind the view.
function onOpen(toast, queue, heldBack) {
  return { queue: [], heldBack: heldBack.concat(queue), drop: !!toast && !toast.sticky }
}

// Leaving: a pop-up on screen and the ones behind it wait for the return.
function onLeave(toast, queue, heldBack) {
  if (!toast) return { toast: toast, queue: queue, heldBack: heldBack }
  return { toast: null, queue: [], heldBack: [toast].concat(queue, heldBack) }
}

// The sender closed notification `key`: its pop-up goes from the waiting
// and the held-back ones unless it bundles others; `next`: the one on screen
// goes (a fleeting one, volume or Omarchy's feedback, stays its few seconds).
function afterClosed(toast, queue, heldBack, key) {
  var stays = function(t) { return t.key !== key || t.count > 1 }
  return { queue: queue.filter(stays), heldBack: heldBack.filter(stays),
           next: !!toast && toast.key === key && toast.count === 1 && !toast.ephemeral }
}

// How long a pop-up stays (it does not run out at all when sticky);
// `factor` is the user's "Pop-ups bleiben" (SettingsLogic.popupFactor).
function duration(toast, factor) {
  var ms = !toast ? 5000 : toast.duration ? toast.duration : isProblem(toast.level) ? 8000 : 5000
  return Math.round(ms * (factor > 0 ? factor : 1))
}

// Critical pop-ups outlive a shell restart (an update restarts it): the
// ones on screen, waiting or held back go to a file, and the new shell
// shows them again. What the user has not clicked away must not get lost.
function stickyOnes(toast, queue, heldBack) {
  var list = [], keys = {}
  var all = (toast ? [toast] : []).concat(queue, heldBack)
  for (var i = 0; i < all.length; i++) {
    var t = all[i]
    if (!t.sticky || keys[t.key]) continue
    keys[t.key] = true
    list.push(t)
  }
  return list
}

// What popups.json keeps (Settings `history`, as NoteLogic.storedHistory):
// "full" everything, "noText" no message text and pictures, "off" nothing
// (critical pop-ups are gone after a shell restart). Never a test's pop-up,
// nor one of the first minutes' (they come again as long as they apply).
function storedSticky(list, mode) {
  list = list.filter(function(t) { return !ProbeLogic.isTest(t) && !t.onboarding })
  if (mode === "off") return []
  if (mode !== "noText") return list
  // A critical summary's names are titles, often the message text itself.
  return list.map(function(t) { var c = NoteLogic.textless(t); if (c.names) c.names = []; return c })
}

// The file after a shell start. The sender's live object died with the
// old shell: no buttons, no reply field, no pictures held only in memory.
function restoreSticky(raw) {
  var list = []
  try { list = JSON.parse(String(raw || "[]")) } catch (e) { list = [] }
  if (!Array.isArray(list)) return []
  return list.filter(function(t) { return t && t.sticky && t.key }).map(function(t) {
    t.actions = []; t.reply = false
    if (String(t.image || "").indexOf("image://qsimage/") === 0) t.image = ""
    return t
  })
}

// The first minutes (#192). setup.json's "since": when the first setup ran
// (0 for a setup from before #192 or a broken file).
function setupSince(text) {
  try { var r = JSON.parse(String(text || "")); return r && Number(r.since) > 0 ? Number(r.since) : 0 } catch (e) { return 0 }
}

// What the island offers at its start: "setup" while setup.json is missing
// (the plugin switched on without the setup), "welcome" once after a first
// setup (`welcomed`: the "since" it last greeted for, ui.json), else "".
function firstRun(missing, text, welcomed) {
  if (missing) return "setup"
  var since = setupSince(text)
  return since > Number(welcomed || 0) ? "welcome" : ""
}

// Their pop-ups: they stay until clicked away, with one button each
// (IslandLogic.actionCommand); the greeting with O-Morchy waving.
var setupKey = "buddy-setup"
function setupToast(time, lang) {
  return { key: setupKey, time: time, source: "buddy", level: "info", sticky: true, onboarding: true,
           title: Strings.tl(lang, "first.setup.title"), body: Strings.tl(lang, "first.setup.body"), action: "setup" }
}
function welcomeToast(time, lang, name) {
  return { key: "buddy-welcome", time: time, source: "buddy", level: "info", sticky: true, onboarding: true, emote: "wave",
           title: name ? Strings.tl(lang, "first.welcome.title", name) : Strings.tl(lang, "first.welcome.titleNoName"), body: Strings.tl(lang, "first.welcome.body"), action: "try" }
}

function hasTitle(toast, needle) {
  return String(toast.title || "").indexOf(needle) !== -1
}

// news.json text → items, newest first.
function parseNews(raw) {
  var list = []
  try { list = JSON.parse(String(raw || "[]")) } catch (e) { list = [] }
  if (!Array.isArray(list)) list = []
  list.sort(function(a, b) { return Number(b.time || 0) - Number(a.time || 0) })
  return list
}

// What the history lists and counts as unread: not the items meant only for
// a pop-up (omarchy-buddy-say --popup-only, a finished agent run).
function listed(list) {
  return list.filter(function(item) { return !item.popup_only })
}

function newest(list) {
  return list.length ? Number(list[0].time || 0) : 0
}

// Items newer than the last pop-up, oldest first, without those the user is
// already watching (watched(item) says so) and those meant only for the
// history (omarchy-buddy-say --quiet).
function freshNews(list, lastToasted, watched) {
  var fresh = []
  for (var i = list.length - 1; i >= 0; i--)
    if (Number(list[i].time || 0) > lastToasted && !list[i].quiet && !watched(list[i])) fresh.push(NoteLogic.clipped(list[i]))
  return fresh
}

// "jetzt prüfen": while omarchy-buddy-feed runs it says so, afterwards for a
// few seconds what it found (items newer than the click), then it is the
// link again. check: { running, done, failed, found }; failed: the feed did
// not get through (Helper.qml: did not start, ran too long, an error).
var checkShowMs = 4000

function checkLabel(check, lang) {
  if (check.running) return Strings.tl(lang, "check.running")
  if (!check.done) return Strings.tl(lang, "check.idle")
  if (check.failed) return Strings.tl(lang, "check.failed")
  return check.found === 0 ? Strings.tl(lang, "check.none") : check.found === 1 ? Strings.tl(lang, "check.one") : Strings.tl(lang, "check.many", check.found)
}

function newSince(list, since) {
  return list.filter(function(item) { return Number(item.time || 0) >= since }).length
}

// A finished run in the terminal the user is looking at needs no pop-up.
// Orca panes all share one window; whether the pane itself was showing
// only the hook can ask Orca, it marks the item "watched".
function watching(item, away, windowFocused) {
  if (!agentSource(item.source) || item.level !== "good" || away) return false
  return item.orca ? item.watched === true : windowFocused(item.window)
}
