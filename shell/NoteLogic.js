.pragma library
.import "Strings.js" as Strings
.import "ProbeLogic.js" as ProbeLogic

// Desktop notifications: turning what a sender sent into a plain record,
// what pops up (Ruhemodus), bundling per sender and the history. Pure
// functions (no Quickshell, no QML), so tests/*.test.js can load this file
// in Node; Notifications.qml holds the live objects.

var historyLimit = 100  // records in the history
var liveLimit = 30      // newest records whose live object (actions, reply) is kept

var appNames = { "notify-send": "System", "omarchy-action": "Omarchy" }

function appLabel(app) { return appNames[app] || app || "App" }

// Who a notification is from: the website for one from a browser (webOrigin),
// the reminder service's own name for GNOME Calendar's (makeNote), else the app.
function senderOf(note) { return note.site || appLabel(note.app) }

function actionLabel(text, lang) {
  var key = "action." + String(text).toLowerCase()
  return Strings.hasIn(lang, key) ? Strings.tl(lang, key) : text
}

// The server advertises plain bodies, but plenty of apps send markup
// anyway; Labels render plain text, so the usual tags and entities go
// (only those: "a<b && c>d" is plain text). Some (Orca) send Markdown:
// bold stars and backticks go too.
function plain(text) {
  return String(text || "").replace(/\*\*|`/g, "").replace(/<br\s*\/?>/gi, "\n").replace(/<\/?(b|i|u|a|img|span)(\s+[\w-]+(\s*=\s*("[^"]*"|'[^']*'|[^\s>]+))?)*\s*\/?>/gi, "")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, "\"")
    .replace(/&#39;|&apos;/g, "'").replace(/&amp;/g, "&").trim()
}

function fileUrl(path) {
  path = String(path || "")
  return path.charAt(0) === "/" ? "file://" + path : path
}

// Pictures come from this machine only: an address on the net would tell
// the sender when the notification is shown.
function isRemote(url) {
  url = String(url || "")
  return url.indexOf("://") !== -1 && !/^(file|image):\/\//i.test(url)
}

// Messages from people: "chat" (a speech bubble on the app icon), "mail"
// (a letter), "event" (a calendar: a reminder of an appointment, #166) or "".
// The sender's category says it first (im.error, email.bounced and the like
// are not from people); without one, the app's name or desktop entry against
// a list of known chat, mail and calendar apps (whole words: "Signal
// Desktop", "Mozilla Thunderbird"). No calendar sends a category; the
// reminder services of GNOME Calendar and Evolution (evolution-alarm-notify)
// and of KOrganizer and Merkuro (kalendarac) say who they are, Thunderbird
// does not (its reminders stay "mail"). tests/fixtures/calendar-notes has samples.
var chatApps = /\b(beeper|signal|telegram|whatsapp|wasistlos|zapzap|element|schildichat|nheko|fractal|cinny|riot|discord|vesktop|webcord|slack|teams|zulip|mattermost|rocket\.chat|gajim|pidgin|kaidan|polari|hexchat|konversation|threema|caprine|messenger|google[ -]messages|ferdium|rambox|revolt|nextcloud talk)\b/i
var calendarApps = /\b(evolution-alarm-notify|kalendarac)\b/i
var mailApps = /\b(thunderbird|betterbird|mailspring|geary|evolution|kmail2?|claws|sylpheed|aerc|trojita|balsa|gmail|mail\.google|outlook|hey|proton ?mail|tutanota|tuta|fastmail)\b/i

function messageKind(app, entry, category) {
  var c = String(category || "").toLowerCase()
  if (c === "im" || c === "im.received") return "chat"
  if (c === "email" || c === "email.arrived") return "mail"
  if (/^(im|email)\./.test(c)) return ""
  // The dots of a desktop entry (org.telegram.desktop) separate words too.
  var names = String(app || "") + "\n" + String(entry || "")
  if (calendarApps.test(names)) return "event"  // before mail: "evolution-alarm-notify"
  return chatApps.test(names) ? "chat" : mailApps.test(names) ? "mail" : ""
}

// Chromium and the browsers built on it (also Omarchy's web apps, chromium
// --app) send as "Chromium", "Google Chrome", "Brave" ... and put the site
// as the first paragraph of the body: "www.instagram.com\n\n<text>"
// (a link around it if the server shows markup, only the registrable
// domain past 28 characters). Firefox sends no origin at all. Null when the
// body does not start that way; else the site's name (known ones by name,
// others by host), whether it is a chat or mail service, and the body
// without the origin.
var browsers = /\b(chromium|chrome|brave|microsoft[ -]edge|vivaldi|opera|helium)\b/i
var webSites = [
  ["instagram.com", "Instagram", "chat"], ["x.com", "X", "chat"], ["twitter.com", "X", "chat"],
  ["facebook.com", "Facebook", "chat"], ["messenger.com", "Messenger", "chat"],
  ["discord.com", "Discord", "chat"], ["web.whatsapp.com", "WhatsApp", "chat"],
  ["web.telegram.org", "Telegram", "chat"], ["app.slack.com", "Slack", "chat"],
  ["teams.microsoft.com", "Teams", "chat"], ["teams.live.com", "Teams", "chat"],
  ["chat.google.com", "Google Chat", "chat"], ["app.element.io", "Element", "chat"],
  ["mail.google.com", "Gmail", "mail"], ["outlook.live.com", "Outlook", "mail"],
  ["outlook.office.com", "Outlook", "mail"], ["outlook.office365.com", "Outlook", "mail"],
  ["mail.proton.me", "Proton Mail", "mail"], ["app.tuta.com", "Tuta", "mail"],
  ["app.fastmail.com", "Fastmail", "mail"],
  ["calendar.google.com", "Google Calendar", "event"], ["calendar.proton.me", "Proton Calendar", "event"],
  ["calendar.zoho.com", "Zoho Calendar", "event"], ["calendar.zoho.eu", "Zoho Calendar", "event"],
  ["calendar.notion.so", "Notion Calendar", "event"], ["web.morgen.so", "Morgen", "event"]
]

// Tuta sends mail and calendar from one page; a reminder there has the same
// title and text ("14:00 Teammeeting"), so the text goes.
function webOrigin(app, entry, body, summary) {
  if (!browsers.test(String(app || "") + "\n" + String(entry || ""))) return null
  var m = /^((?:[a-z0-9-]+\.)+[a-z]{2,}|localhost)(:\d+)?(\n\n|$)/i.exec(String(body || ""))
  if (!m) return null
  var host = m[1].toLowerCase()
  var rest = String(body).slice(m[0].length).trim()
  for (var i = 0; i < webSites.length; i++) {
    var d = webSites[i][0]
    if (host !== d && host.slice(-d.length - 1) !== "." + d) continue
    if (d === "app.tuta.com" && rest && rest === summary) return { site: "Tuta", kind: "event", body: "" }
    return { site: webSites[i][1], kind: webSites[i][2], body: rest }
  }
  return { site: host.replace(/^www\./, "") + (m[2] || ""), kind: "", body: rest }
}

// Chromium adds "Settings" (its own notification settings, untranslated) to
// every web notification; the site's own buttons stay (#163).
function webActions(actions) {
  return (actions || []).filter(function(a) { return a.id !== "settings" })
}

// What the mark says to a screen reader, and a row's name with it.
function kindName(kind, lang) { return kind ? Strings.tl(lang, "kind." + kind) : "" }
function noteName(note, lang) {
  var kind = kindName(note.kind, lang)
  return senderOf(note) + (kind ? ", " + kind : "") + ": " + titleOf(note)
}

function isMedia(app, category) {
  return /spotify/i.test(String(app || "")) || /music/i.test(String(category || ""))
}

// The record for one notification. `raw` holds what Notifications.qml read
// off the live object: app, summary, body, image, imageHint (image-path),
// icon (already resolved), category, entry (desktop entry), glyph, exec,
// execActions (the hint omarchy-actions), urgency, expire, actions [{id, text}],
// reply, replyHint, transient, sync (the hint x-canonical-private-synchronous
// or x-dunst-stack-tag) and, for music, the MPRIS player (trackArtUrl, trackTitle, trackArtist) or null.
//
// A sync tag (volume, brightness ...) makes a running display: each message
// replaces the last one with the same tag instead of bundling with it, on
// screen and in the history, like the title of a player on screen.
function makeNote(raw, key, time) {
  var app = String(raw.app || "")
  // Quickshell hands image-path as image://icon/<path or name>: a file is
  // the picture, a theme name (notify-send -i) is the icon.
  var image = fileUrl(raw.image || raw.imageHint)
  if (isRemote(image)) image = ""
  var icon = String(raw.icon || "")
  if (image.indexOf("image://icon/") === 0) {
    var rest = image.slice(13)
    if (rest.charAt(0) === "/") image = "file://" + rest
    else { icon = icon || image; image = "" }
  }
  var summary = plain(raw.summary)
  var body = plain(raw.body)
  var web = webOrigin(app, raw.entry, body, summary)
  if (web) body = web.body
  var site = web ? web.site : ""
  // evolution-alarm-notify titles every reminder "Erinnerungen" (in the
  // user's language) and puts the event in the first line: the event is the
  // title, the service the sender.
  var eds = /^(org\.gnome\.)?evolution-alarm-notify$/i
  if (eds.test(app) || eds.test(String(raw.entry || ""))) {
    var lines = body.split("\n")
    if (lines[0]) { site = summary; summary = lines[0]; body = lines.slice(1).join("\n").trim() }
  }
  var media = isMedia(app, raw.category)
  var sync = String(raw.sync || "")
  var player = media ? raw.player : null
  var commands = execActions(raw.execActions) || []
  if (player && player.trackArtUrl) image = player.trackArtUrl
  if (player && player.trackTitle) { summary = player.trackTitle; body = player.trackArtist || "" }
  return { key: key, app: app, summary: summary, body: body, icon: icon,
           image: image, glyph: String(raw.glyph || ""),
           exec: String(raw.exec || ""), execActions: commands, urgency: Number(raw.urgency), time: time,
           expire: Number(raw.expire || 0), actions: web ? webActions(raw.actions) : raw.actions || [], reply: raw.reply === true,
           replyHint: String(raw.replyHint || ""), media: media,
           site: site,
           kind: media ? "" : web && web.kind || messageKind(app, raw.entry, raw.category),
           replaces: media || sync !== "",
           // A running display (volume, brightness) only pops up; so does
           // Omarchy's feedback, unless it brings buttons (a saved recording).
           ephemeral: raw.transient === true || (app === "omarchy-action" && !commands.length) || sync !== "",
           // Orca's "Claude finished" is what O-Morchy reports itself.
           seen: /^orca$/i.test(app) && /claude/i.test(summary),
           group: media ? app : sync ? app + "\nsync:" + sync : app + "\n" + (site ? site + "\n" : "") + summary }
}

// What pops up:
//   critical - stays until clicked away, even in Ruhemodus
//   event    - an appointment (#166) stays until clicked away too, but not
//              red, and in Ruhemodus it only goes into the history (#169)
//   normal   - 8 s (longer if the app asks, at most 30 s)
//   low      - history only (Omarchy's feedback toasts excepted)
//   music    - 3 s, never in the history (the player window shows it, #139)
// Ruhemodus (or a shared screen) lets only critical ones and Omarchy's
// feedback through; Claude's requests always win over all of them. the user's
// rule for the app (SettingsLogic.appRule) comes on top: "historyOnly"
// lets only critical ones pop up, "ignore" nothing.
function popsUp(note, silent, rule) {
  var critical = note.urgency === 2
  if (rule === "ignore" || (rule === "historyOnly" && !critical)) return false
  return !note.seen && (note.urgency !== 0 || note.ephemeral || note.media)
    && (!silent || (critical && note.kind !== "event") || note.app === "omarchy-action")
}

// Whether the history keeps it at all: not Omarchy's feedback toasts and
// transient ones, not music (#139), not an app the user ignores. Without
// `rule`: whether a pop-up leaves anything behind.
function kept(note, rule) {
  return !note.ephemeral && !note.media && rule !== "ignore"
}

function toastDuration(note) {
  return note.media ? 3000 : note.app === "omarchy-action" && note.ephemeral ? 5000 : Math.min(30000, Math.max(8000, note.expire))
}

// Without a title the text takes its place, so the app name does not stand twice.
function titleOf(note) { return note.summary || note.body || senderOf(note) }
function textOf(note) { return note.summary ? note.body : "" }

function noteToast(note, count) {
  var critical = note.urgency === 2
  return { note: true, source: "app", key: note.key, group: note.group, count: count || 1,
           app: note.app, site: note.site || "", title: titleOf(note), body: textOf(note), textTitle: !note.summary, time: note.time,
           level: critical ? "error" : "info", sticky: critical || note.kind === "event", media: note.media, ephemeral: note.ephemeral,
           duration: toastDuration(note),
           icon: note.icon, image: note.image, glyph: note.glyph, exec: note.exec, execActions: note.execActions, kind: note.kind,
           actions: note.actions, reply: note.reply, replyHint: note.replyHint }
}

// Where a new message of `group` goes: into the pop-up on screen (not while
// the user types a reply to it), into a waiting or held-back one of the same
// sender ({ where: "queue"/"held", index }), or a pop-up of its own ("new").
function joinTarget(toast, queue, heldBack, group, replyKey) {
  if (toast && toast.group === group && replyKey !== toast.key) return { where: "toast" }
  for (var i = 0; i < queue.length; i++) if (queue[i].group === group) return { where: "queue", index: i }
  for (var j = 0; j < heldBack.length; j++) if (heldBack[j].group === group) return { where: "held", index: j }
  return { where: "new" }
}

// A message from a sender whose pop-up is on screen or waiting joins it:
// the newest text, one more in the count (a running display just shows the
// newest). A critical one keeps the bundle critical, an appointment keeps it standing.
function merged(toast, note) {
  var next = noteToast(note, note.replaces ? 1 : (toast.count || 1) + 1)
  next.sticky = next.sticky || toast.sticky
  if (toast.level === "error") next.level = "error"
  return next
}

// The history with `note` on top. One entry per player and per sync tag:
// the history holds the current one only, the older ones come back as
// `replaced`. `older`
// are the keys past liveLimit, whose live objects can go.
function addToHistory(notes, note) {
  var replaced = []
  // A rewritten one (replaces_id) keeps its key and moves to the top.
  var list = notes.filter(function(o) { return o.key !== note.key })
  if (note.replaces) list = list.filter(function(o) {
    if (o.group !== note.group) return true
    replaced.push(o.key)
    return false
  })
  list = [note].concat(list)
  return { notes: capped(list), replaced: replaced,
           older: list.slice(liveLimit).map(function(o) { return o.key }) }
}

// A sender rewrote notification note.key (replaces_id). A pop-up showing it,
// waiting or held back follows with its count; `found` false: there is
// none, and it pops up again as the specification asks.
function rewrite(toast, queue, heldBack, note) {
  var found = false
  function follow(t) {
    if (!t || t.key !== note.key) return t
    found = true
    var next = noteToast(note, t.count)
    next.sticky = next.sticky || t.sticky
    return next
  }
  var next = { toast: follow(toast), queue: queue.map(follow), heldBack: heldBack.map(follow) }
  next.found = found
  return next
}

// A rewrite in place (replaces_id) that changes nothing the user would see.
function sameContent(a, b) {
  return a.summary === b.summary && a.body === b.body && a.image === b.image
    && JSON.stringify(a.actions) === JSON.stringify(b.actions) && JSON.stringify(a.execActions) === JSON.stringify(b.execActions)
}

// `readIds`: notifications the user saw as a pop-up (key → time, IslandLogic.readBy).
function isUnread(n, lastRead, readIds) {
  return n.time > lastRead && !n.replaces && !n.media && !n.seen && !(readIds && readIds[n.key])
}

// The history view: one row per app and sender, newest first.
function groups(notes, lastRead, readIds) {
  var list = [], byGroup = {}
  for (var i = 0; i < notes.length; i++) {
    var n = notes[i]
    var g = byGroup[n.group]
    if (!g) { g = byGroup[n.group] = { group: n.group, note: n, count: 0, unread: false }; list.push(g) }
    g.count++
    if (isUnread(n, lastRead, readIds)) g.unread = true
  }
  return list
}

// "Rückgängig" after deleting: the removed records come back in their place,
// next to what arrived meanwhile (a running display only if it has no newer one).
function withRestored(notes, removed) {
  var keys = {}, groups = {}
  for (var i = 0; i < notes.length; i++) { keys[notes[i].key] = true; groups[notes[i].group] = true }
  var back = removed.filter(function(o) { return !keys[o.key] && !(o.replaces && groups[o.group]) })
  return capped(notes.concat(back).sort(function(a, b) { return b.time - a.time }))
}

// The newest historyLimit records, counted apart for real and test
// notifications (ProbeLogic.isTest): a test never pushes out a real one.
function capped(notes) {
  var real = 0, test = 0
  return notes.filter(function(o) { return (ProbeLogic.isTest(o) ? ++test : ++real) <= historyLimit })
}

// Keys of the group's records from the last hour (what "Schließen" on a
// bundled pop-up closes).
function recentInGroup(notes, group, since) {
  var keys = []
  for (var i = 0; i < notes.length && notes[i].time > since; i++) if (notes[i].group === group) keys.push(notes[i].key)
  return keys
}

// The history file after a shell start. Live objects died with the old
// shell: no actions, no replies. Music from before #139 goes. Null when the
// file holds no list.
function restoreHistory(raw) {
  var list = []
  try { list = JSON.parse(raw) } catch (e) { list = [] }
  if (!Array.isArray(list)) return null
  return list.filter(function(o) { return o && o.key && !o.media }).map(function(o) {
    o.actions = []; o.reply = false; o.execActions = execActions(JSON.stringify(o.execActions || null)) || []
    o.time = Number(o.time || 0); o.urgency = Number(o.urgency || 1)
    if (o.kind === undefined) o.kind = o.media ? "" : messageKind(o.app)  // kept before #123
    if (String(o.image || "").indexOf("image://qsimage/") === 0) o.image = ""
    return o
  })
}

// What notifications.json keeps (Settings `history`): "full" everything,
// "noText" app, sender and time without message text, pictures and buttons, "off"
// nothing (the list stays in memory until the shell restarts).
var historyModes = ["full", "noText", "off"]

function historyMode(value) {
  return historyModes.indexOf(value) !== -1 ? value : "full"
}

// Test notifications never reach the file, so none is left behind when the
// shell restarts before a test has cleaned up.
function storedHistory(notes, mode) {
  mode = historyMode(mode)
  notes = notes.filter(function(o) { return !ProbeLogic.isTest(o) })
  if (mode === "off") return []
  if (mode === "full") return notes
  return notes.map(textless)
}

// A record or pop-up for "noText": no message text, pictures, reply hint or
// commands (their argv names files and folders). A pop-up without a heading
// carries its text as title (noteToast): the sender's name takes its place (#170).
function textless(o) {
  var copy = Object.assign({}, o, { body: "", image: "", replyHint: "", exec: "", execActions: [] })
  if (o.textTitle) copy.title = senderOf(o)
  return copy
}

// The sender's own buttons worth showing: no "default", no empty text, three at most.
function buttons(actions) {
  return (actions || []).filter(function(a) { return a.id !== "default" && a.text !== "" }).slice(0, 3)
}

// Omarchy's own toasts carry their click as a JSON argv (--exec of
// omarchy-notification-send); it runs without a shell. Also takes the list
// itself (an entry of omarchy-actions).
function execArgv(text) {
  try {
    var argv = Array.isArray(text) ? text : JSON.parse(String(text || ""))
    if (!Array.isArray(argv) || !argv.length) return null
    for (var i = 0; i < argv.length; i++) if (typeof argv[i] !== "string") return null
    return argv[0] && argv[0].charAt(0) !== "-" ? argv : null
  } catch (e) { return null }
}

// Omarchy's buttons (omarchy-notification-send --action, Omarchy 4.5): the
// hint omarchy-actions, a JSON list of up to three {label, argv}, each argv
// held to execArgv's rules. All or nothing, like Omarchy: null when malformed.
function execActions(text) {
  var list
  try { list = JSON.parse(String(text || "")) } catch (e) { return null }
  if (!Array.isArray(list) || !list.length || list.length > 3) return null
  var out = []
  for (var i = 0; i < list.length; i++) {
    var a = list[i]
    var argv = a && typeof a.label === "string" && a.label.trim() ? execArgv(a.argv) : null
    if (!argv) return null
    out.push({ label: a.label.slice(0, 256), argv: argv })
  }
  return out
}

// Every button a notification shows, in Omarchy's order: its own commands
// first (they run without the sender, also from the history), then the
// sender's while it still listens. `id` is "exec:<n>" for a command.
function noteButtons(item, live) {
  var out = (item.execActions || []).map(function(a, i) { return { id: "exec:" + i, text: a.label } })
  return out.concat(live ? buttons(item.actions) : [])
}

// What Omarchy's "act" key (Super + Komma, notifications.act) does with the
// newest pop-up, as Omarchy decides it: one thing to do → do it (the click,
// or else the one button), more than one → hand over the keyboard, nothing
// → put it away. `clickable`: a command of its own or the sender's default
// action. The click of a notification with Omarchy's buttons is its first
// button, so it does not count twice.
function actOn(item, buttons, clickable) {
  if (!item) return "none"
  if (!item.note) return "activate"  // news and the like: their click
  var count = buttons.length + (clickable && !(item.execActions || []).length ? 1 : 0)
  if (count > 1) return "keyboard"
  if (clickable) return "activate"
  if (count === 1) return "press"
  return "dismiss"
}

// The island is the notification server only while Omarchy's own
// notifications plugin is off in ~/.config/omarchy/shell.json (the setup
// turns it off). Before that, e.g. right after `omarchy plugin add` answered
// "Enable now?" with yes, two servers would share one shell (#187).
// shell.json mid-write keeps what was known.
function serving(shellJson, before) {
  var config
  try { config = JSON.parse(shellJson) } catch (e) { return before === true }
  return !!config && Array.isArray(config.disabledPlugins) && config.disabledPlugins.indexOf("omarchy.notifications") !== -1
}

// setDnd's argument as Omarchy's scripts send it.
function truthy(value) {
  var v = String(value || "").toLowerCase()
  return v === "true" || v === "1" || v === "on" || v === "yes"
}
