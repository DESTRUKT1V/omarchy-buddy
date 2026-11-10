.pragma library
.import "NoteLogic.js" as NoteLogic
.import "Strings.js" as Strings
.import "SessionLogic.js" as SessionLogic

// The island as a whole: size (zoom), which view it shows, O-Morchy's mood and
// the texts that sum everything up. Pure functions (no Quickshell, no QML),
// so tests/*.test.js can load this file in Node.

// (an agent's news: its name from SessionLogic.agents)
var sourceLabel = { system: "System", coding: "Coding", terminal: "Terminal",
                    kuma: "Uptime Kuma", github: "GitHub", buddy: "O-Morchy", mochi: "O-Morchy" }

// A news item's source in a few letters ("mochi": O-Morchy's old name).
function sourceName(source, lang) {
  if (Object.prototype.hasOwnProperty.call(SessionLogic.agents, source)) return SessionLogic.agents[source].name
  return sourceLabel[source] || Strings.tl(lang, "source.new")
}

// The layer surface's height: what the view needs (island or player window
// below the gap, in px), at most full. It grows at once; it shrinks only
// once the island's resize has settled, so nothing is cut off on the way.
function surfaceHeight(current, needed, full, settled) {
  var h = Math.min(Math.ceil(needed), full)
  return h > current || settled ? h : current
}

// One factor from the screen's real pixel density, so the island looks the
// same size on a laptop and on a desktop monitor. The measures are meant
// for about 104 logical px per inch (a 27"/34" monitor at 1440p); denser
// screens scale up, by 0.05 steps, up to twice the size.
function autoZoom(density, ratio) {
  if (!(density > 0)) return 1
  var ppi = density * 25.4 / (ratio || 1)
  return Math.min(2, Math.max(1, Math.round(ppi / 104 * 20) / 20))
}

// "zoom" in ui.json wins over the automatic one.
function zoom(setting, auto) { return setting > 0 ? setting : auto }

// The screen the island sits on, by name. The bar runs on every screen, so
// the island goes where the user works: the monitor Hyprland has focused. A
// screen set in ui.json ("screen": "DP-1") wins while it is connected.
// While the island shows something (hold), it stays where it is, so a
// pop-up or the open view does not jump to the other monitor under the
// pointer. names: the connected screens, in Quickshell's order.
function pickScreen(names, focused, pinned, current, hold) {
  if (!names.length) return ""
  if (pinned && names.indexOf(pinned) !== -1) return pinned
  if (hold && names.indexOf(current) !== -1) return current
  if (names.indexOf(focused) !== -1) return focused
  if (names.indexOf(current) !== -1) return current
  return names[0]
}

// The screen object named `name` (pickScreen's choice) in Quickshell's
// list, else the first one, null without any (#229).
function screenFor(screens, name) {
  for (var i = 0; i < screens.length; i++) if (screens[i].name === name) return screens[i]
  return screens.length ? screens[0] : null
}

// The island has no screen in the list (none yet, or its monitor is gone; a
// monitor that comes back is a new object): it must unmap before it maps on
// the next one, else it stays on the dead output (#229).
function screenGone(screens, held) { return screens.indexOf(held) === -1 }

// Light Omarchy themes (Catppuccin Latte, Flexoki Light, Rosé Pine, White)
// have a mid-dark text colour on a near-white background: the same
// transparency gives far less contrast there than on a dark theme. Light
// means the background's relative luminance (r, g, b from 0 to 1) is above
// one half.
function luminance(c) {
  var f = function(v) { return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4) }
  return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b)
}

function isLight(r, g, b) { return luminance({ r: r, g: g, b: b }) > 0.5 }

// WCAG contrast ratio of two colours { r, g, b }.
function contrast(a, b) {
  var la = luminance(a), lb = luminance(b)
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05)
}

// "#rrggbb" → { r, g, b } from 0 to 1.
function hex(h) {
  return { r: parseInt(h.substr(1, 2), 16) / 255, g: parseInt(h.substr(3, 2), 16) / 255, b: parseInt(h.substr(5, 2), 16) / 255 }
}

// a, moved by t (0…1) toward b; also b drawn with opacity t over a.
function mix(a, b, t) {
  return { r: a.r + (b.r - a.r) * t, g: a.g + (b.g - a.g) * t, b: a.b + (b.b - a.b) * t }
}

// Shades that differ between dark and light themes: "good" (finished,
// calm), "aside" (a session in the background), "red" (where the theme's
// own red is too close to its accent) and where secondary text
// starts (inks lifts the text further where a theme needs it).
function shades(light) {
  return light ? { good: "#3f6f78", aside: "#6e5a92", red: "#c62828", muted: 0.75 }
               : { good: "#87a9b0", aside: "#a996c8", red: "#f25c54", muted: 0.55 }
}

// CIE L*a*b* of a colour { r, g, b }, for how different two colours look.
function lab(c) {
  var f = function(v) { return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4) }
  var r = f(c.r), g = f(c.g), b = f(c.b)
  var h = function(t) { return t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116 }
  var x = h((0.4124 * r + 0.3576 * g + 0.1805 * b) / 0.95047), y = h(0.2126 * r + 0.7152 * g + 0.0722 * b),
      z = h((0.0193 * r + 0.1192 * g + 0.9505 * b) / 1.08883)
  return [116 * y - 16, 500 * (x - y), 200 * (y - z)]
}

// Colour difference (CIE76 ΔE): below about 30 a small red mark passes for
// the accent (last-horizon #c38b7b against #b59790: 13).
function distance(a, b) {
  var p = lab(a), q = lab(b)
  return Math.sqrt(Math.pow(p[0] - q[0], 2) + Math.pow(p[1] - q[1], 2) + Math.pow(p[2] - q[2], 2))
}
var minDistance = 30

// `from`, moved toward `to` in steps of 0.05 until it has `min` contrast on
// every one of `surfaces` (at most `to` itself); surfaces(c) for surfaces
// tinted with the colour itself.
function readable(from, to, min, surfaces) {
  for (var i = 0; i < 20; i++) {
    var c = mix(from, to, i / 20)
    var on = typeof surfaces === "function" ? surfaces(c) : surfaces
    if (on.every(function(s) { return contrast(c, s) >= min })) return c
  }
  return to
}

// The colours text and icons take in a theme (fg, bg, accent, urgent as
// { r, g, b }, light: isLight): secondary text, red (sharpened where it is
// close to the accent) and accent as text, good
// and aside, each at least 4.5:1 (WCAG AA) on the background, a card, a
// row tinted red (needs you) and an unread row (F6).
// Themes that already reach it keep their look; others get stronger text.
function inks(fg, bg, accent, urgent, light) {
  var sh = shades(light)
  var surfaces = function(r) { return [bg, mix(bg, fg, 0.08), mix(bg, r, 0.12), mix(bg, accent, 0.07)] }
  var red = function(from) { return readable(from, fg, 4.5, surfaces) }
  var muted = function(r) { return readable(mix(bg, fg, sh.muted), fg, 4.5, surfaces(r)) }
  // "braucht dich" must look neither like "arbeitet" (accent) nor like
  // secondary text: a red too close to either gives way to a clear one
  // (still 4.5:1). Rosé Pine's light red, lifted toward its mauve text, was
  // both (#187).
  var apart = function(r) { return Math.min(distance(r, accent), distance(r, muted(r))) }
  var ownRed = red(urgent), sharpRed = red(hex(sh.red))
  var urgentInk = apart(ownRed) >= minDistance || apart(sharpRed) <= apart(ownRed) ? ownRed : sharpRed
  var on = surfaces(urgentInk)
  return { muted: muted(urgentInk), urgent: urgentInk,
           accent: readable(accent, fg, 4.5, on), good: readable(hex(sh.good), fg, 4.5, on),
           aside: readable(hex(sh.aside), fg, 4.5, on),
           // Spotify's own green for "in your Liked Songs" (#163): an icon,
           // so 3:1 on the player window and its hover, darker on light themes.
           spotify: readable(hex(spotifyGreen), fg, 3, [bg, mix(bg, fg, 0.12)]) }
}
var spotifyGreen = "#1ed760"  // Spotify's brand green

function pad2(n) { return (n < 10 ? "0" : "") + n }

// "14:05" today, "27.10. 14:05" (English: "Oct 27 14:05") on any other day.
function when(t, now, lang) {
  var d = new Date(t * 1000)
  var time = pad2(d.getHours()) + ":" + pad2(d.getMinutes())
  if (d.toDateString() === new Date(now * 1000).toDateString()) return time
  var months = Strings.tl(lang, "months")
  if (months) return months.split(" ")[d.getMonth()] + " " + d.getDate() + " " + time
  return pad2(d.getDate()) + "." + pad2(d.getMonth() + 1) + ". " + time
}

// A local day as "2026-10-29" (t in seconds).
function dayKey(t) {
  var d = new Date(t * 1000)
  return d.getFullYear() + "-" + pad2(d.getMonth() + 1) + "-" + pad2(d.getDate())
}

// "Heute", "Gestern", "Mi., 29.10." (English: "Wed, Oct 29").
function dayLabel(t, now, lang) {
  var d = new Date(t * 1000), n = new Date(now * 1000)
  if (dayKey(t) === dayKey(now)) return Strings.tl(lang, "news.today")
  if (dayKey(t) === dayKey(new Date(n.getFullYear(), n.getMonth(), n.getDate() - 1, 12).getTime() / 1000))
    return Strings.tl(lang, "news.yesterday")
  var wd = Strings.tl(lang, "weekdays").split(" ")[d.getDay()]
  var months = Strings.tl(lang, "months")
  if (months) return wd + ", " + months.split(" ")[d.getMonth()] + " " + d.getDate()
  return wd + ", " + pad2(d.getDate()) + "." + pad2(d.getMonth() + 1) + "."
}

// The news list by local day (#183), newest day first: today unfolded with
// at most newsTodayMax items (the rest behind "N weitere heute"), older days
// folded to a row with their count. `unfolded` (day key → true) is what the
// user opened: an older day, or all of today.
// → [{ key, label, today, count, open, items (shown), more (today's row to
//   fold or unfold, "" for none) and moreName, name (for a screen reader:
//   day, count, folded or not) }]
var newsTodayMax = 5

function newsDays(items, now, unfolded, lang) {
  var days = [], byKey = {}, today = dayKey(now)
  unfolded = unfolded || {}
  var sorted = items.slice().sort(function(a, b) { return Number(b.time || 0) - Number(a.time || 0) })
  for (var i = 0; i < sorted.length; i++) {
    var t = Number(sorted[i].time || 0), k = dayKey(t)
    if (!byKey[k]) {
      byKey[k] = { key: k, label: dayLabel(t, now, lang), today: k === today, all: [] }
      days.push(byKey[k])
    }
    byKey[k].all.push(sorted[i])
  }
  return days.map(function(d) {
    var count = d.all.length, open = d.today || !!unfolded[d.key]
    var cut = d.today && !unfolded[d.key] ? newsTodayMax : count
    var name = d.label + ", " + (count === 1 ? Strings.tl(lang, "news.one") : Strings.tl(lang, "news.many", count))
      + ", " + Strings.tl(lang, open ? "a11y.unfolded" : "a11y.folded")
    // Today's row below its items: "3 weitere heute", unfolded "weniger anzeigen".
    var more = !d.today || count <= newsTodayMax ? ""
      : Strings.tl(lang, cut < count ? "news.moreToday" : "news.lessToday", count - newsTodayMax)
    return { key: d.key, label: d.label, today: d.today, count: count, open: open,
             items: open ? d.all.slice(0, cut) : [], more: more,
             moreName: more && more + ", " + Strings.tl(lang, cut < count ? "a11y.folded" : "a11y.unfolded"), name: name }
  })
}

function greeting(hour, name, lang) {
  return Strings.tl(lang, hour < 5 ? "greet.night" : hour < 11 ? "greet.morning" : hour < 17 ? "greet.day"
    : hour < 22 ? "greet.evening" : "greet.late", name)
}

// The user's first name, from a `getent passwd` line: the first word of
// the full name (GECOS), otherwise the login name with a capital letter.
function firstName(passwdLine) {
  var fields = String(passwdLine || "").trim().split(":")
  var full = String(fields[4] || "").split(",")[0].trim()
  if (full) return full.split(/\s+/)[0]
  var login = String(fields[0] || "")
  return login ? login.charAt(0).toUpperCase() + login.slice(1) : ""
}

// O-Morchy falls asleep sooner at night.
function night(hour) { return hour >= 23 || hour < 7 }

// What the user has read: everything up to `lastRead` (the open view, "alles
// gelesen") and, after that, single items they saw as a pop-up (`readIds`: id →
// time). News items are told apart by their time (omarchy-buddy-say keeps it
// unique), notifications by their key.
function newsId(item) { return "news:" + Number(item.time || 0) }

function newsUnread(item, lastRead, readIds) {
  return Number(item.time || 0) > lastRead && !(readIds && readIds[newsId(item)])
}

// News items and notifications the user has not seen.
function unread(news, notes, lastRead, readIds) {
  var list = []
  for (var i = 0; i < news.length; i++) if (newsUnread(news[i], lastRead, readIds)) list.push(news[i])
  for (var j = 0; j < notes.length; j++) {
    var n = notes[j]
    if (NoteLogic.isUnread(n, lastRead, readIds))
      list.push({ source: "app", app: n.app, site: n.site || "", level: n.urgency === 2 ? "error" : "info", time: n.time, kind: n.kind || "" })
  }
  return list
}

// The open view's "Für dich" block (#175): what the user can act on now, at
// the top and not again below. Besides the waiting agents
// (SessionLogic.forYouPart): messages from people, event reminders (a
// notification with a kind) and critical notifications, and problems in the
// news. Each stays until the user clicks it or takes it out with × (#178,
// `doneIds`: id → time, doneBy), not when it is only read; everything up to
// `doneUpTo` is done, and nothing older than `since` stays (forYouKeep).
// → the block's notification groups and news, and the others for below.
var forYouKeep = 24 * 3600

// The block's `since` at `now`: by the hour, so the list is rebuilt only then.
// markDone keeps doneIds from the same bound, or × on a 24–25 h old one does nothing (#245).
function forYouSince(now) {
  return Math.floor(now / 3600) * 3600 - forYouKeep
}

function pending(id, time, doneUpTo, doneIds, since) {
  return Number(time || 0) > Math.max(doneUpTo, since) && !(doneIds && doneIds[id])
}

function forYou(groups, notes, news, doneUpTo, doneIds, since) {
  var r = { notes: [], otherNotes: [], news: [], otherNews: [] }
  var open = {}
  for (var k = 0; k < notes.length; k++) {
    var n = notes[k]
    if ((n.kind || n.urgency === 2) && !n.media && pending(n.key, n.time, doneUpTo, doneIds, since)) open[n.group] = true
  }
  for (var i = 0; i < groups.length; i++)
    (open[groups[i].group] ? r.notes : r.otherNotes).push(groups[i])
  for (var j = 0; j < news.length; j++)
    (hasProblem([news[j]]) && pending(newsId(news[j]), news[j].time, doneUpTo, doneIds, since) ? r.news : r.otherNews).push(news[j])
  return r
}

// What a click on an item or its × takes out of "Für dich": a news item, or
// a notification with every earlier one of its sender (the row or pop-up
// stands for all of them).
function doneBy(item, notes) {
  var ids = {}
  if (!item) return ids
  if (!item.group) { if (item.time) ids[newsId(item)] = Number(item.time); return ids }
  ids[item.key] = item.time
  for (var i = 0; i < notes.length; i++)
    if (notes[i].group === item.group && notes[i].time <= item.time) ids[notes[i].key] = notes[i].time
  return ids
}

// A news item's name for a screen reader: its level and whether it is unread
// in words, not only as the dot's colour and the bold title.
function newsName(item, unread, lang) {
  var level = item.level === "error" || item.level === "warn" ? Strings.tl(lang, "level." + item.level) + ": " : ""
  return level + (item.title || "") + (unread ? ", " + Strings.tl(lang, "a11y.unread") : "")
}

function hasProblem(items) {
  return items.some(function(i) { return i.level === "error" || i.level === "warn" })
}

// What the pill shows for unread items instead of the dot: "chat", "mail" or
// "event" when the newest one is a message from a person or an event
// reminder, "" for the dot. A problem keeps the (red) dot.
function pillMark(items) {
  if (hasProblem(items)) return ""
  var newest = null
  for (var i = 0; i < items.length; i++) if (!newest || Number(items[i].time || 0) > Number(newest.time || 0)) newest = items[i]
  return newest && newest.kind || ""
}

// The newest time the user has now seen (what "read" means for the dot).
function readUpTo(lastRead, news, notes) {
  return Math.max(lastRead, news.length ? Number(news[0].time || 0) : 0, notes.length ? notes[0].time : 0)
}

// A pop-up that was on screen counts as read: a news item itself, a
// notification with everything its bundle stands for (the sender's
// messages up to the pop-up). A summary ("5 Neuigkeiten") only named them.
function readBy(toast, notes) {
  if (!toast || toast.names) return {}
  return doneBy(toast.note ? toast : { time: toast.time }, notes)
}

// `readIds` plus `ids`, without what `lastRead` already covers (keeps ui.json small).
function addRead(readIds, ids, lastRead) {
  var next = {}
  var all = [readIds || {}, ids || {}]
  for (var i = 0; i < all.length; i++)
    for (var id in all[i]) if (Number(all[i][id]) > lastRead) next[id] = Number(all[i][id])
  return next
}

// Clicks right after the island changed what it shows would hit something
// The user has not seen yet (the second click of a double click, a pop-up
// sliding in under the pointer): for this long they do nothing.
var clickGuardMs = 300

// What a click could hit; when it changes to something new, the guard
// starts. Peek and pill only open the island, they need none.
function clickTarget(mode, toastKey, askKey) {
  return mode === "open" ? "open" : mode === "needs" ? "needs:" + askKey
    : mode === "toast" ? "toast:" + toastKey : ""
}

// A Hyprland window address for "address:…", or "" when it is none (it
// comes from news.json/state.json and goes into a Hyprland command).
function windowAddress(a) {
  a = String(a || "")
  return /^(0x)?[0-9a-f]+$/i.test(a) ? (a.indexOf("0x") === 0 ? a : "0x" + a) : ""
}

// A news item does something on a click: open its link, focus its window or
// Orca pane. Its action (actionCommand) has a button of its own (actionLabel).
function clickable(item) {
  return !!(item && (item.url || item.window || item.orca))
}

// What a click on a news item does (#248): "open" its link, window or Orca;
// without those and without a button "unfold" a cut-off text and "fold" it
// again; "" nothing.
function newsClick(item, truncated, open, lang) {
  if (clickable(item)) return "open"
  if (actionLabel(item.action, lang) || !(truncated || open)) return ""
  return open ? "fold" : "unfold"
}

// The label of a news item's action button, "" for none (#169).
function actionLabel(action, lang) {
  if (!actionCommand(action, "", lang)) return ""
  return Strings.tl(lang, { updates: "btn.update", setup: "btn.setup", "try": "btn.try" }[action] || "btn.investigate")
}

// The command behind a news item's action, from the checkout `repo`; null for
// none. "updates": the terminal that installs them; "crash:PID": the agent
// (or coredumpctl) investigates that crash. The first minutes' pop-ups
// (#192): "setup" runs the setup in Omarchy's floating terminal, so its
// report shows (it restarts the shell; without that terminal on its own),
// "try" sends a desktop notification in `lang`.
function actionCommand(action, repo, lang) {
  if (action === "updates") return [repo + "/bin/omarchy-buddy-update"]
  if (action === "setup") return ["bash", "-c", "command -v omarchy-launch-floating-terminal-with-presentation >/dev/null && "
    + "exec omarchy-launch-floating-terminal-with-presentation \"$(printf %q \"$0\")\"; exec \"$0\"", repo + "/bin/omarchy-buddy-setup"]
  if (action === "try") return ["notify-send", "-a", "O-Morchy", Strings.tl(lang, "first.try.title"), Strings.tl(lang, "first.try.body")]
  var m = /^crash:([0-9]+)$/.exec(String(action || ""))
  return m ? [repo + "/bin/omarchy-buddy-crash", m[1]] : null
}

// Whether a pop-up stays after its action button: the setup's offer stays
// until setup.json is there (Buddy.qml withdraws it then), so a No in the
// setup's question leaves it on screen (#208).
function actionKeepsToast(action) {
  return action === "setup"
}

// What a click on the island does: right click "close" (the open view),
// "dismiss" (the pop-up) or "goToAsk"; left click on a pop-up "activateNote",
// "activate" (its window or link) or "openFromToast", elsewhere "open".
function clickAction(right, mode, toast) {
  if (right) return mode === "open" ? "close" : mode === "toast" ? "dismiss" : "goToAsk"
  if (mode === "toast") return toast.note ? "activateNote" : clickable(toast) ? "activate" : "openFromToast"
  return mode === "open" ? "none" : "open"
}

// A click on the bar widget (#182): left opens or closes the open view like
// any Omarchy pop-up (a pop-up on screen makes room for it), right as on
// the island.
function widgetClickAction(right, mode, toast) {
  if (right) return clickAction(true, mode, toast)
  return mode === "open" ? "close" : mode === "toast" ? "openFromToast" : "open"
}

// The bar widget's text (#182), only while something goes on: a request
// (the agent's name, or how many) or agents at work; nothing at rest.
function barText(counts, lang) {
  if (counts.needs > 0) return counts.needs === 1 ? Strings.tl(lang, "a11y.needs", counts.needsName || "Claude") : Strings.tl(lang, "sum.needs", counts.needs)
  if (counts.working > 0) return counts.working === 1 ? Strings.tl(lang, "sum.working.one", counts.workingName || "Claude") : Strings.tl(lang, "sum.working.many", counts.working)
  return ""
}

// O-Morchy's pixel size in the bar: as large as its 17×15 grid fits the
// bar's thickness, in half steps (OMorchy keeps those sharp), at least 1.
function barMorchyPx(barSize) {
  return Math.max(1, Math.floor((barSize - 2) / 15 * 2) / 2)
}

// Where the island's surface sits (#182): at the bar's edge, under (beside)
// the bar widget, as an Omarchy pop-up opens at its widget; on a top or
// bottom bar in the screen's middle (#200). s: { edge
// ("top", "bottom", "left", "right"), bar (its thickness, 0 when hidden),
// gap, screenW, screenH, surfaceW, fullH (the surface's widest and tallest),
// widget ({ x, y, w, h } on the screen, null: not in a bar) }. Returns the
// surface's margin from the screen's left (top and bottom bar) or top
// (left and right bar), `centre`: the screen's middle inside the surface,
// and `inset`: from the surface's bar edge to the island.
function dock(s) {
  var clamp = function(v, lo, hi) { return Math.max(lo, Math.min(v, hi)) }
  var w = s.widget
  if (s.edge === "left" || s.edge === "right") {
    var wy = w ? w.y : s.gap
    var top = Math.round(clamp(wy, 0, Math.max(0, s.screenH - s.fullH)))
    return { left: 0, top: top, centre: 0, inset: Math.max(s.gap, wy - top) }
  }
  var cx = s.screenW / 2  // top and bottom: the screen's middle, like a Dynamic Island, not under the widget (#200)
  var left = Math.round(clamp(cx - s.surfaceW / 2, 0, Math.max(0, s.screenW - s.surfaceW)))
  return { left: left, top: 0, centre: cx - left, inset: s.bar + s.gap }
}

// The island's x inside that surface: centred on `centre` and kept on the
// surface (top, bottom), or right beside the bar (left, right).
function islandX(edge, centre, bar, gap, surfaceW, width) {
  if (edge === "left") return bar + gap
  if (edge === "right") return surfaceW - bar - gap - width
  return Math.round(Math.max(gap, Math.min(centre - width / 2, surfaceW - width - gap)))
}

// The one-line summary in peek and in the open view's header.
// counts: { needs, working, shown, background } sessions (background: shown
// ones without a window, SessionLogic.background), workingName: the agent
// of the one working session ("Claude", "Codex").
function summary(counts, unreadItems, lang) {
  if (counts.needs > 0) return Strings.tl(lang, "sum.needs", counts.needs)
  var parts = [], bg = counts.background || 0, open = counts.shown - bg
  if (counts.working > 0) parts.push(counts.working === 1 ? Strings.tl(lang, "sum.working.one", counts.workingName || "Claude") : Strings.tl(lang, "sum.working.many", counts.working))
  else if (open > 0) parts.push(open === 1 ? Strings.tl(lang, "sum.open.one") : Strings.tl(lang, "sum.open.many", open))
  if (bg > 0) parts.push(parts.length ? Strings.tl(lang, "sum.bg", bg) : bg === 1 ? Strings.tl(lang, "sum.bg.one") : Strings.tl(lang, "sum.bg.many", bg))
  if (unreadItems.length > 0) {
    var bySource = {}, order = []
    for (var i = 0; i < unreadItems.length; i++) {
      var src = unreadItems[i].app ? NoteLogic.senderOf(unreadItems[i]) : sourceName(unreadItems[i].source, lang)
      if (!bySource[src]) { bySource[src] = 0; order.push(src) }
      bySource[src]++
    }
    // "5 von Claude, 2 von Signal, 3 weitere": two senders by name, the rest counted.
    var named = order.slice(0, 2).map(function(s) {
      return s === Strings.tl(lang, "source.new") ? Strings.tl(lang, "sum.new", bySource[s]) : Strings.tl(lang, "sum.from", bySource[s], s)
    })
    var rest = 0
    for (var j = 2; j < order.length; j++) rest += bySource[order[j]]
    if (rest) named.push(Strings.tl(lang, "sum.more", rest))
    parts.push(named.join(", "))
  }
  return parts.length ? parts.join(", ") : Strings.tl(lang, "sum.quiet")  // a sentence, no "·" chain (#193)
}

// Which view the island shows. A request the user can answer in the island
// (answerable: SessionLogic.answerable) wins over pop-ups; a session that
// only asks in its terminal lets them through first.
function mode(opened, ask, toast, peeking, answerable) {
  return opened ? "open" : ask && answerable ? "needs" : toast ? "toast" : ask ? "needs" : peeking ? "peek" : "pill"
}

// s: { needs, working, unreadProblem, away, mode, quietFor (seconds without
// activity), night }. An agent at work: O-Morchy thinks (#177).
function mood(s) {
  return s.needs > 0 ? "needs"
    : s.working > 0 ? "thinking"
    : s.unreadProblem ? "worried"
    : (s.away || (s.mode === "pill" && s.quietFor > (s.night ? 120 : 600))) ? "sleep"
    : "idle"
}
