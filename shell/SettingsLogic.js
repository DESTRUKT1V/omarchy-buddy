.pragma library
.import "NoteLogic.js" as NoteLogic
.import "Strings.js" as Strings
.import "SessionLogic.js" as SessionLogic

// The user's settings in ~/.config/omarchy-buddy/config.json: what they may
// hold, reading a hand-edited file (a missing value is the default, a
// broken file changes nothing), taking over the old values from ui.json
// once, and what the settings page offers. Pure functions (no Quickshell,
// no QML), so tests/*.test.js can load this file in Node; Settings.qml
// holds the values and the file.
//
//   zoom          0 (from the screen) or a fixed factor, 0.8 to 1.6
//   popupTime     how long pop-ups stay: "short", "normal", "long"
//   reduceMotion  the island resizes without overshoot, the ticker stands still
//   language      "auto" (from the system, Strings.pickLanguage), "de", "en"
//   font          the island's font: "" Omarchy's (Style.font), or a family
//                 (the page offers omarchy-font-list and Adwaita Sans, #182)
//   whenSharing   while the screen is shared: "nothing", "quiet" (Ruhemodus)
//                 or "hide" (no island at all; "veil" before #107 means the same)
//   history       what the notification history keeps on disk (NoteLogic.storedHistory)
//   aiButton      "Mit KI ansehen" on critical notifications without a button
//                 of their own (NoteLogic.wantsAi, #235)
//   apps          per app: "normal", "historyOnly" (no pop-up unless critical)
//                 or "ignore" (no pop-up, no history)
//   updateCheck   omarchy-buddy-check tests the island after an Omarchy update
//   updateNews    omarchy-buddy-feed looks for updates every 12 hours (lib/updates.py)
//   gitRepos      per git clone the update watcher found ("~/path", lib/gitwatch.py):
//                 false leaves it out (#224); only "false" is kept
//   longCommands  a terminal command of a minute or more says when it is done
//                 (lib/long-commands.sh; the switch runs omarchy-buddy-setup --commands)
//   weather       "Omarchy-Wetter ersetzen" (#184): Omarchy's weather out of the
//                 bar (omarchy-buddy-setup --weather), the tile and bar text instead
//   limitWarn     % of a Claude limit that brings a warning (0: never;
//                 omarchy-buddy-statusline reads it too)
//   screen        a fixed monitor ("DP-1"; empty: the focused one)
//   agents        per agent (SessionLogic.agents' keys): false switches it off,
//                 the setup takes its hooks out (#158); only "false" is kept
//   feed          the feed's own sources (bin/omarchy-buddy-feed): "kuma" an
//                 Uptime Kuma status page (empty: off), "github" false: no gh;
//                 other keys in the file are kept as they are

var defaults = { zoom: 0, popupTime: "normal", reduceMotion: false, language: "auto", font: "",
                 whenSharing: "hide", history: "full", aiButton: true, apps: {},
                 updateCheck: false, updateNews: true, longCommands: false, weather: false, limitWarn: 80, screen: "",
                 agents: {}, gitRepos: {}, feed: { kuma: "", github: true } }

// Settings that are gone: an old file may still hold them, they are dropped
// without a word (tickerInPill until #174).
var retired = ["tickerInPill"]

var popupTimes = ["short", "normal", "long"]
var sharingModes = ["nothing", "quiet", "hide"]
var appRules = ["normal", "historyOnly", "ignore"]
var languages = ["auto", "de", "en"]
var zoomSteps = [0, 0.9, 1, 1.15, 1.3]
var zoomMin = 0.8, zoomMax = 1.6

function oneOf(list, value, fallback) { return list.indexOf(value) !== -1 ? value : fallback }

function isObject(v) { return v !== null && typeof v === "object" && !Array.isArray(v) }

// "feed" as the page shows it; keys it does not show stay as they are.
function feedSources(raw) {
  var out = {}
  if (isObject(raw)) for (var k in raw) out[k] = raw[k]
  out.kuma = typeof out.kuma === "string" ? out.kuma.trim() : ""
  out.github = out.github !== false
  return out
}

// Whatever the file says, as valid settings: unknown or wrong values give
// way to the default, one by one.
function normalize(raw) {
  raw = isObject(raw) ? raw : {}
  var zoom = Number(raw.zoom)
  var warn = Number(raw.limitWarn)
  var apps = {}
  if (isObject(raw.apps))
    for (var name in raw.apps) {
      var rule = oneOf(appRules, raw.apps[name], "normal")
      if (name && rule !== "normal") apps[name] = rule
    }
  return {
    zoom: zoom >= zoomMin && zoom <= zoomMax ? zoom : 0,
    popupTime: oneOf(popupTimes, raw.popupTime, defaults.popupTime),
    reduceMotion: raw.reduceMotion === true,
    language: oneOf(languages, raw.language, defaults.language),
    font: typeof raw.font === "string" ? raw.font.trim() : "",
    whenSharing: raw.whenSharing === "veil" ? "hide" : oneOf(sharingModes, raw.whenSharing, defaults.whenSharing),
    history: NoteLogic.historyMode(raw.history),
    aiButton: raw.aiButton !== false,
    apps: apps,
    updateCheck: raw.updateCheck === true,
    updateNews: raw.updateNews !== false,
    longCommands: raw.longCommands === true,
    weather: raw.weather === true,
    limitWarn: raw.limitWarn === undefined || raw.limitWarn === null || isNaN(warn) ? defaults.limitWarn : Math.max(0, Math.min(100, warn)),
    screen: typeof raw.screen === "string" ? raw.screen.trim() : "",
    agents: agentsOff(raw.agents),
    gitRepos: agentsOff(raw.gitRepos),
    feed: feedSources(raw.feed)
  }
}

// The settings whose value in the file was not taken (normalize put the
// default or a corrected value in its place), as "key: value".
function invalid(raw, settings) {
  var list = []
  for (var k in defaults) {
    if (!(k in raw)) continue
    var bad = k === "apps" ? !isObject(raw.apps) || Object.keys(raw.apps).some(function(a) { return appRules.indexOf(raw.apps[a]) === -1 })
      : k === "whenSharing" && raw[k] === "veil" ? false
      : k === "agents" || k === "gitRepos" ? !isObject(raw[k]) || Object.keys(raw[k]).some(function(a) { return typeof raw[k][a] !== "boolean" })
      : k === "feed" ? !isObject(raw.feed) || "kuma" in raw.feed && typeof raw.feed.kuma !== "string"
                       || "github" in raw.feed && typeof raw.feed.github !== "boolean"
      : JSON.stringify(settings[k]) !== JSON.stringify(raw[k])
    if (bad) list.push(k + ": " + JSON.stringify(raw[k]))
  }
  return list
}

// The file's text → { ok, settings, extra, invalid }. An empty or missing
// file is fine (all defaults); one that does not parse is not ok and
// Settings.qml keeps what it had. `extra` holds keys this version does not
// know, so saving from the page keeps them; `invalid` the values it did not
// take (the page names them).
function parse(text) {
  text = String(text || "").trim()
  if (text === "") return { ok: true, settings: normalize({}), extra: {}, invalid: [] }
  var raw
  try { raw = JSON.parse(text) } catch (e) {}
  if (!isObject(raw)) return { ok: false, settings: null, extra: {}, invalid: [] }
  var extra = {}
  for (var k in raw) if (!(k in defaults) && retired.indexOf(k) === -1) extra[k] = raw[k]
  var settings = normalize(raw)
  return { ok: true, settings: settings, extra: extra, invalid: invalid(raw, settings) }
}

// The file as the page writes it: every setting, defaults included, so
// The user sees what there is; unknown keys stay at the end.
function serialize(settings, extra) {
  var out = {}
  var s = normalize(settings)
  for (var k in defaults) out[k] = s[k]
  for (var e in extra || {}) if (!(e in defaults)) out[e] = extra[e]
  return JSON.stringify(out, null, 2) + "\n"
}

// Until #81 the settings sat in ui.json (Prefs.qml); the first config.json
// takes them from there. veilWhenSharing false meant: quiet, not veiled.
function fromUi(text) {
  var ui = {}
  try { ui = JSON.parse(String(text || "{}")) } catch (e) { ui = {} }
  if (!isObject(ui)) ui = {}
  var raw = {}
  var keys = ["zoom", "history", "updateCheck", "limitWarn", "screen"]
  for (var i = 0; i < keys.length; i++) if (ui[keys[i]] !== undefined) raw[keys[i]] = ui[keys[i]]
  if (ui.veilWhenSharing === false) raw.whenSharing = "quiet"
  return normalize(raw)
}

// A new value from the page: the settings with this one change (on a copy).
function edited(settings, change) {
  var next = normalize(settings)
  change(next)
  return normalize(next)
}

function withValue(settings, key, value) { return edited(settings, function(s) { s[key] = value }) }

function withFeed(settings, key, value) { return edited(settings, function(s) { s.feed[key] = value }) }

// The address of an Uptime Kuma status page as omarchy-buddy-feed takes it
// (kuma_api): http(s), a host, a path ending in /status/NAME.
// "off" (empty), "invalid" or "ok".
function kumaAddress(text) {
  text = String(text || "").trim()
  if (text === "") return "off"
  return /^https?:\/\/[^\/\s?#]+(\/[^\s?#]*)?\/status\/[^\/\s?#]+\/?([?#]\S*)?$/i.test(text) ? "ok" : "invalid"
}

// The line under the Kuma field for Settings.kumaCheck ("off", "invalid",
// "checking", "ok", "unreachable"): { text, error }.
function kumaNote(check, lang) {
  var key = ["invalid", "checking", "ok", "unreachable"].indexOf(check) !== -1 ? check : "off"
  return { text: Strings.tl(lang, "settings.kuma." + key), error: key === "invalid" || key === "unreachable" }
}

// The agents (or git clones) switched off: { name: false }, nothing else (on is the default).
function agentsOff(raw) {
  var out = {}
  if (isObject(raw)) for (var name in raw) if (name && raw[name] === false) out[name] = false
  return out
}

function withAgent(settings, agent, on) {
  return edited(settings, function(s) { if (on) delete s.agents[agent]; else s.agents[agent] = false })
}

// The agents that never ran for real with the buddy's hooks (#158):
// built from their docs and Orca's parsers only.
// Muse ran, but without a model: no tool or question ever came for real.
var untestedAgents = ["cursor-agent", "copilot", "agy", "qwen", "kimi", "devin", "commandcode", "kiro-cli", "muse"]

// The "Agents" section: the installed ones (omarchy-buddy-setup --agents,
// one per line) in the island's order, without Claude (always on) and
// without names the island does not know.
function agentRows(installed, settings) {
  var off = settings && settings.agents || {}
  return SessionLogic.foundAgents(installed).filter(function(a) { return a.id !== "claude" }).map(function(a) {
    return { id: a.id, name: a.name, on: off[a.id] !== false, untested: untestedAgents.indexOf(a.id) !== -1 }
  })
}

function withGitRepo(settings, path, on) {
  return edited(settings, function(s) { if (on) delete s.gitRepos[path]; else s.gitRepos[path] = false })
}

// The update watcher's clones (omarchy-buddy-feed --git-list, one "~/path"
// per line, then a tab and its state if it has one) as the page lists them:
// { path, name, on, state, watched }, in the feed's order. The name is the
// folder without a leading dot ("oh-my-zsh"); state is "dirty", "detached" or
// "build" (#225, "settings.git.STATE"), "" for nothing to say or switched off.
// "config": a clone with its own git settings, never watched (#228), so no
// switch (watched false) and always its line (#232).
var gitStates = ["dirty", "detached", "build", "config"]

function gitRows(listText, settings) {
  var off = settings && settings.gitRepos || {}
  return String(listText || "").split("\n").filter(function(l) { return l.trim() !== "" }).map(function(l) {
    var p = l.split("\t")[0], parts = p.replace(/\/+$/, "").split("/")
    var state = oneOf(gitStates, l.split("\t")[1], ""), watched = state !== "config", on = watched && off[p] !== false
    return { path: p, name: parts[parts.length - 1].replace(/^\.+/, "") || p, on: on,
             state: on || !watched ? state : "", watched: watched }
  })
}

function appRule(settings, app) {
  var apps = settings && settings.apps || {}
  return oneOf(appRules, apps[String(app || "")], "normal")
}

function withAppRule(settings, app, rule) {
  return edited(settings, function(s) { if (rule === "normal") delete s.apps[app]; else s.apps[app] = rule })
}

// The apps the page lists: those that sent something (newest history
// first) and those with a rule, each once, alphabetically. Omarchy's own
// feedback and test notifications are not the user's to silence here.
function pageApps(notes, settings) {
  var seen = {}, list = []
  function add(name) {
    name = String(name || "")
    if (!name || seen[name] || name === "omarchy-action" || name === "Buddy-Test") return
    seen[name] = true
    list.push(name)
  }
  for (var i = 0; i < (notes || []).length; i++) add(notes[i].app)
  for (var k in (settings && settings.apps) || {}) add(k)
  return list.sort(function(a, b) { return a.toLowerCase() < b.toLowerCase() ? -1 : a.toLowerCase() > b.toLowerCase() ? 1 : 0 })
}

// What omarchy-buddy-setup --commands said, for the page: its text, and
// the line to add by hand when chezmoi manages a shell file (the setup
// prints it last).
function commandsReply(text) {
  var lines = String(text || "").trim().split("\n")
  var line = /^\[ -r /.test(lines[lines.length - 1]) ? lines.pop() : ""
  return { note: lines.join("\n"), line: line }
}

// What omarchy-buddy-setup --bar said: "offer", "undo" or "" (nothing to
// arrange); anything else is why it could not (the page shows it).
function barReply(text) {
  var t = String(text || "").trim()
  return ["offer", "undo", ""].indexOf(t) !== -1 ? { state: t, note: "" } : { state: "", note: t }
}

// How much longer or shorter than normal pop-ups stay.
function popupFactor(popupTime) {
  return popupTime === "short" ? 0.5 : popupTime === "long" ? 2 : 1
}

function quietWhenSharing(settings) { return settings.whenSharing !== "nothing" }
function hideWhenSharing(settings) { return settings.whenSharing === "hide" }

// Hyprland reports a screenshot with grim as a short screencast as well;
// only a share that lasts longer than this counts.
var shareDelay = 1000

// Captures running after Hyprland's event (screencast>>1,owner starts one,
// screencast>>0,owner ends one). Counted, because a screenshot taken while
// the screen is shared sends its own start and end: its end must not end
// the share. Never below 0 (a share that began before the shell started).
function screencasts(count, data) {
  return String(data || "").charAt(0) === "1" ? count + 1 : Math.max(0, count - 1)
}

// "Größe" on the page: "automatisch (105 %)" for the automatic one.
function zoomLabel(step, auto, lang) {
  var pct = Strings.tl(lang, "zoom.percent", Math.round((step > 0 ? step : auto) * 100))
  return step > 0 ? pct : Strings.tl(lang, "zoom.auto", pct)
}

// The open view's text under the Ruhemodus button while the screen is
// shared (hidden, the island shows nothing).
function sharingNote(settings, sharing, lang) {
  return sharing && settings.whenSharing === "quiet" ? Strings.tl(lang, "sharing.quiet") : ""
}

// The choices on the page, in the user's words (functions: the words
// follow the language).
function zoomOptions(auto, lang) {
  return zoomSteps.map(function(step) { return { value: step, label: zoomLabel(step, auto, lang) } })
}
function options(values, lang) {
  return values.map(function(v) { return { value: v, label: Strings.tl(lang, "opt." + v) } })
}
function popupTimeOptions(lang) { return options(popupTimes, lang) }
function sharingOptions(lang) { return options(sharingModes, lang) }
function historyOptions(lang) { return options(NoteLogic.historyModes, lang) }
function appOptions(lang) { return options(appRules, lang) }
// Each language in its own words, so it can be found in any of them.
function languageOptions(lang) {
  return [{ value: "auto", label: Strings.tl(lang, "opt.auto") }, { value: "de", label: "Deutsch" }, { value: "en", label: "English" }]
}

// The fonts to pick (#182): Omarchy's own first, then what
// omarchy-font-list prints (one family per line) and Adwaita Sans, the
// island's font until then, if installed; one set by hand stays in the list.
// Each label is written in its own font.
function fontOptions(listText, installed, current, lang) {
  var names = String(listText || "").split("\n").map(function(n) { return n.trim() }).filter(Boolean)
  if (installed.indexOf("Adwaita Sans") !== -1) names.push("Adwaita Sans")
  if (current && names.indexOf(current) === -1) names.push(current)
  var list = [{ value: "", label: Strings.tl(lang, "opt.omarchy") }]
  for (var i = 0; i < names.length; i++)
    if (names.indexOf(names[i]) === i) list.push({ value: names[i], label: names[i], font: names[i] })
  return list
}

// The family the island uses: the chosen one while it is installed, Omarchy's otherwise.
function fontFamily(setting, installed, omarchy) {
  return setting && installed.indexOf(setting) !== -1 ? setting : omarchy
}

// A zoom set by hand that is none of the steps still shows as chosen.
function zoomOptionsWith(auto, current, lang) {
  var list = zoomOptions(auto, lang)
  if (zoomSteps.indexOf(current) === -1) list.push({ value: current, label: zoomLabel(current, auto, lang) })
  return list
}
