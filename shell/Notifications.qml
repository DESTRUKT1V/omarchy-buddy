import QtQuick
import Quickshell
import Quickshell.Io
import Quickshell.Services.Mpris
import Quickshell.Services.Notifications
import "NoteLogic.js" as NoteLogic
import "IslandLogic.js" as IslandLogic
import "ToastLogic.js" as ToastLogic
import "SettingsLogic.js" as SettingsLogic
import "SessionLogic.js" as SessionLogic
import "theme"

// The desktop's only notification server (once the setup has disabled
// Omarchy's notifications plugin, NoteLogic.serving), its history in
// ~/.local/state/omarchy-buddy/notifications.json and the "notifications" IPC
// that Omarchy's scripts and key bindings call (ping, toggleDnd,
// dismissOne, act, keyboard ...).
//
// Every notification lands in `notes` (the history), except Omarchy's own
// feedback toasts, transient ones, music and apps the user ignores (config.json "apps"). What pops up, and how messages from
// the same app and sender bundle into one pop-up, is in NoteLogic.js.
Scope {
  id: store
  required property var app
  readonly property var toasts: app.toasts

  // Newest first, plain records only. The live Notification objects
  // (needed for actions and replies) sit in `refs` by key, outside any
  // model: the server destroys them when the sender closes them, and a
  // model role holding one would dangle. refsVersion lets bindings notice
  // changes to the map.
  property var notes: []
  property var refs: ({})
  property int refsVersion: 0
  property bool loaded: false
  property string replyKey: ""     // the notification whose reply field is open

  readonly property var groups: NoteLogic.groups(notes, app.prefs.lastRead, app.prefs.readIds)

  function hint(n, name) {
    try {
      var v = n.hints[name]
      return v === undefined || v === null ? "" : String(v)
    } catch (e) { return "" }
  }

  function iconOf(n) {
    var icon = String(n.appIcon || "")
    // A path or an address: only one on this machine (NoteLogic.localPicture, #261); else a theme name.
    if (icon.indexOf("/") !== -1 || icon.indexOf(":") !== -1) return NoteLogic.localPicture(icon)
    var names = [icon, String(n.desktopEntry || ""), String(n.appName || "").toLowerCase()]
    for (var i = 0; i < names.length; i++) {
      if (!names[i]) continue
      var path = Quickshell.iconPath(names[i], true)
      if (path) return path
    }
    return ""
  }

  // The media player behind a music notification (Spotify sends no cover,
  // MPRIS has it, and title, artist and album separately).
  function playerFor(app) {
    var name = String(app || "").toLowerCase()
    if (!name) return null
    var list = Mpris.players.values
    for (var i = 0; i < list.length; i++) {
      var p = list[i]
      if (String(p.identity || "").toLowerCase() === name || String(p.desktopEntry || "").toLowerCase() === name) return p
    }
    return null
  }

  function noteOf(n, key, time) {
    var app = String(n.appName || "")
    var category = hint(n, "category")
    var actions = []
    for (var i = 0; i < n.actions.length; i++)
      actions.push({ id: String(n.actions[i].identifier), text: String(n.actions[i].text) })
    return NoteLogic.makeNote({
      app: app, summary: n.summary, body: n.body, image: n.image, imageHint: hint(n, "image-path"),
      icon: iconOf(n), category: category, entry: n.desktopEntry, glyph: hint(n, "omarchy-glyph"), exec: hint(n, "omarchy-exec-argv"),
      execActions: hint(n, "omarchy-actions"),
      urgency: n.urgency, expire: n.expireTimeout, actions: actions, reply: n.hasInlineReply === true,
      replyHint: n.inlineReplyPlaceholder, transient: n.transient === true,
      sync: hint(n, "x-canonical-private-synchronous") || hint(n, "x-dunst-stack-tag"),
      player: NoteLogic.isMedia(app, category) ? playerFor(app) : null
    }, key, time)
  }

  function receive(n) {
    // Without tracked the object dies when this handler returns.
    n.tracked = true
    var key = Date.now() + "-" + n.id
    var note = noteOf(n, key, Date.now() / 1000)
    refs[key] = n
    refsVersion++
    n.closed.connect(function() { store.closed(key, n) })
    var update = function() { store.changed(key, n) }
    var signals = ["summaryChanged", "bodyChanged", "imageChanged", "appIconChanged", "actionsChanged", "urgencyChanged"]
    for (var i = 0; i < signals.length; i++) n[signals[i]].connect(update)

    var rule = SettingsLogic.appRule(app.settings.values, note.app)
    var kept = NoteLogic.kept(note, rule)
    if (kept) addNote(note)
    if (NoteLogic.popsUp(note, app.silent, rule)) showNote(note)
    else if (!kept) release(key, false)
  }

  function addNote(note) {
    var next = NoteLogic.addToHistory(notes, note)
    for (var i = 0; i < next.replaced.length; i++) release(next.replaced[i], false)
    // Live objects only for the newest few (their actions still work from
    // the history).
    for (var j = 0; j < next.older.length; j++)
      if (refs[next.older[j]] && !toasts.onScreen(next.older[j])) release(next.older[j], false)
    notes = next.notes
    notesSave.restart()
  }

  // A message from a sender whose pop-up is on screen or waiting joins it
  // (NoteLogic.joinTarget); on screen, the clock starts over. A pop-up that
  // leaves nothing behind lets go of the message it replaces.
  function showNote(note) {
    app.touch()
    var t = toasts.toast
    var target = NoteLogic.joinTarget(t, toasts.queue, toasts.heldBack, note.group, replyKey)
    var old = null
    if (target.where === "toast") {
      old = t
      toasts.toast = NoteLogic.merged(t, note)
      toasts.restartTimer()
    } else if (target.where !== "new") {
      var name = target.where === "queue" ? "queue" : "heldBack"
      var list = toasts[name].slice()
      old = list[target.index]
      list[target.index] = NoteLogic.merged(old, note)
      toasts[name] = list
    } else toasts.enqueue([NoteLogic.noteToast(note)])
    if (old && !NoteLogic.kept(old) && old.key !== note.key) release(old.key, false)
  }

  // A sender rewrote its notification in place (replaces_id): the record
  // follows and moves to the top, a pop-up showing it follows too, and
  // without one it pops up again (NoteLogic.rewrite). (Music leaves nothing
  // behind: once its pop-up is gone, the player's next title arrives as a new one.)
  function changed(key, n) {
    if (refs[key] !== n) return
    var old = null
    for (var i = 0; i < notes.length; i++) if (notes[i].key === key) old = notes[i]
    var note
    try { note = noteOf(n, key, Date.now() / 1000) } catch (e) { return }
    if (old && NoteLogic.sameContent(old, note)) return
    var rule = SettingsLogic.appRule(app.settings.values, note.app)
    var kept = NoteLogic.kept(note, rule)
    if (kept) addNote(note)
    var step = NoteLogic.rewrite(toasts.toast, toasts.queue, toasts.heldBack, note)
    if (!step.found) {
      if (NoteLogic.popsUp(note, app.silent, rule)) showNote(note)
      else if (!kept) release(key, false)
      return
    }
    if (step.toast !== toasts.toast) {
      toasts.toast = step.toast
      toasts.restartTimer()
    }
    toasts.queue = step.queue
    toasts.heldBack = step.heldBack
  }

  // The sender (or the server) closed it: a pop-up showing only this one
  // goes, the history keeps the text (ToastLogic.afterClosed).
  function closed(key, n) {
    if (refs[key] !== n) return
    delete refs[key]
    refsVersion++
    var step = ToastLogic.afterClosed(toasts.toast, toasts.queue, toasts.heldBack, key)
    toasts.queue = step.queue
    toasts.heldBack = step.heldBack
    if (step.next) toasts.next()
  }

  // Let go of the live object; `dismissed` tells the sender the user closed it
  // (rather than it timing out).
  function release(key, dismissed) {
    var n = refs[key]
    if (!n) return
    delete refs[key]
    refsVersion++
    try {
      if (dismissed) n.dismiss()
      else n.expire()
    } catch (e) {}
  }

  function live(key) { return refsVersion >= 0 && !!refs[key] }

  // Omarchy's buttons always, the sender's while it listens, "Mit KI
  // ansehen" while the setting is on and a default agent is set (#235).
  readonly property bool aiOn: app.settings.values.aiButton && app.sessions.defaultAgent !== ""
  function liveActions(item) {
    if (!item || !item.key) return []
    return NoteLogic.noteButtons(item, live(item.key), aiOn, Theme.lang)
  }

  // Click on a notification: its own command, its default action, or else
  // the app's window. Then it is done.
  function activateNote(item) {
    var argv = NoteLogic.execArgv(item.exec)
    if (argv) Quickshell.execDetached(argv)
    else if (!invokeAction(item, "default") && item.app) Quickshell.execDetached([app.omarchyBin + "omarchy-hyprland-focus-app", item.app])
    finishNote(item)
  }

  function invokeAction(item, id) {
    var n = refs[item.key]
    if (!n) return false
    try {
      for (var i = 0; i < n.actions.length; i++) {
        if (n.actions[i].identifier !== id) continue
        n.actions[i].invoke()
        return true
      }
    } catch (e) {}
    return false
  }

  function hasAction(item, id) {
    var n = refs[item.key]
    if (!n) return false
    try {
      for (var i = 0; i < n.actions.length; i++) if (n.actions[i].identifier === id) return true
    } catch (e) {}
    return false
  }

  function runAction(item, id) {
    var m = /^exec:(\d+)$/.exec(id)
    var argv = m && item.execActions && item.execActions[m[1]] ? NoteLogic.execArgv(item.execActions[m[1]].argv) : null
    if (argv) Quickshell.execDetached(argv)
    // item.ai: no sender buttons, so a sender's own action id "ai" never lands here.
    else if (id === "ai" && item.ai === true && aiOn) app.runWithInput([app.repo + "/bin/omarchy-buddy-analyze"], NoteLogic.aiInput(item))
    else invokeAction(item, id)
    finishNote(item)
  }

  // A waiting request's safe answer ("Ablehnen", SessionLogic.keyboardTarget),
  // else the newest notification's first button, else its row, takes the
  // keyboard in the open view (Omarchy's notifications.keyboard, kept small).
  function keyboardFocus() {
    var n = notes[0], ask = SessionLogic.keyboardTarget(app.sessions.asks)
    if (!ask && !n) return
    Theme.lostKey = ask || (liveActions(n).length ? "noteButton|history|" + n.key + "|0" : "note|" + n.group)
    if (Theme.clicks[Theme.lostKey] && Theme.clicks[Theme.lostKey].visible) Theme.refocus()
  }

  function sendReply(item, text) {
    var n = refs[item.key]
    if (n && String(text).trim() !== "") {
      try { n.sendInlineReply(String(text)) } catch (e) {}
    }
    replyKey = ""
    finishNote(item)
  }

  function finishNote(item) {
    app.markDone(item)
    release(item.key, true)
    if (toasts.toast && toasts.toast.key === item.key) toasts.next()
    else toasts.queue = toasts.queue.filter(function(t) { return t.key !== item.key })
    app.touch()
  }

  // Everything a bundled pop-up stands for (all earlier messages of its
  // sender, the same set read and done take: IslandLogic.doneBy) is closed at the sender.
  function closeBundle(toast) {
    for (var key in IslandLogic.doneBy(toast, notes)) release(key, true)
  }

  // Deleting from the history can be undone for a few seconds; only then
  // do the senders hear that the user closed them.
  property var removed: []
  readonly property bool canUndo: removed.length > 0

  function removeNotes(gone) {
    finishRemoved()
    var keys = {}
    for (var i = 0; i < gone.length; i++) keys[gone[i].key] = true
    removed = gone
    notes = notes.filter(function(o) { return !keys[o.key] })
    notesSave.restart()
    undoTimer.restart()
  }

  function removeGroup(group) { removeNotes(notes.filter(function(o) { return o.group === group })) }

  function clearNotes() { removeNotes(notes) }

  function undoRemove() {
    undoTimer.stop()
    notes = NoteLogic.withRestored(notes, removed)
    removed = []
    notesSave.restart()
  }

  function finishRemoved() {
    undoTimer.stop()
    for (var i = 0; i < removed.length; i++) release(removed[i].key, true)
    removed = []
  }

  Timer {
    id: undoTimer
    interval: 8000
    onTriggered: store.finishRemoved()
  }

  function loadNotes(raw) {
    if (loaded) return
    loaded = true
    var list = NoteLogic.restoreHistory(raw)
    if (list) notes = NoteLogic.capped(notes.concat(list))
  }

  FileView {
    id: notesFile
    path: store.app.ready ? store.app.stateDir + "/notifications.json" : ""
    printErrors: false
    onLoaded: store.loadNotes(text())
    onLoadFailed: store.loadNotes("[]")
  }
  Timer {
    id: notesSave
    interval: 1000
    onTriggered: if (store.loaded) notesFile.setText(JSON.stringify(NoteLogic.storedHistory(store.notes, store.historyMode)) + "\n")
  }
  // The user changed what the history keeps: the file follows at once.
  readonly property string historyMode: app.settings.values.history
  onHistoryModeChanged: notesSave.restart()

  // Omarchy's notifications plugin is off (the setup ran): only then the
  // server and the IPC below, never beside Omarchy's own (#187).
  property bool serving: false
  FileView {
    path: store.app.home + "/.config/omarchy/shell.json"  // where Omarchy's shell reads it
    watchChanges: true
    printErrors: false
    onFileChanged: reload()
    onLoaded: store.serving = NoteLogic.serving(text(), store.serving)
    onLoadFailed: store.serving = false
  }

  // The one notification server on the session bus. Bodies are asked for
  // as plain text (markup could fetch remote images).
  Instantiator {
    active: store.serving
    delegate: NotificationServer {
      keepOnReload: false
      imageSupported: true
      actionsSupported: true
      inlineReplySupported: true
      persistenceSupported: true
      bodyMarkupSupported: false
      onNotification: function(n) { store.receive(n) }
    }
  }

  // What Omarchy's notifications plugin answered, so its key bindings, the
  // menu's silencing toggle and omarchy-notification-wait/-dismiss keep working.
  readonly property var omarchyIpc: omarchyHandler  // Probe.testOmarchy
  IpcHandler {
    id: omarchyHandler
    target: "notifications"
    enabled: store.serving

    function ping(): string { return "ok" }
    function dndState(): string { return store.app.prefs.quiet ? "on" : "off" }
    function isDnd(): string { return dndState() }
    function toggleDnd(): string { store.app.prefs.setQuiet(!store.app.prefs.quiet); return dndState() }
    function setDnd(value: string): string {
      store.app.prefs.setQuiet(NoteLogic.truthy(value))
      return dndState()
    }
    function showHistory(): string { store.app.opened = true; return "ok" }
    function clear(): string { store.clearNotes(); return "ok" }
    function dismissAll(): string { store.toasts.dismissAll(); return "ok" }
    // Only a pop-up the user can see (not one behind a Claude request).
    function dismissOne(): string {
      if (!store.toasts.toast || store.app.mode !== "toast") return "none"
      store.toasts.dismissToast()
      return "ok"
    }
    function invokeLast(): string {
      if (!store.toasts.toast || store.app.mode !== "toast") return "none"
      var t = store.toasts.toast
      if (t.note) store.activateNote(t)
      else { store.toasts.next(); store.app.activate(t) }
      return "ok"
    }
    // Omarchy 4.5 (Super + Komma): the newest pop-up's one thing to do, or
    // the keyboard when it offers more (NoteLogic.actOn).
    function act(): string {
      var t = store.app.mode === "toast" ? store.toasts.toast : null
      var buttons = store.liveActions(t)
      var what = NoteLogic.actOn(t, buttons, !!t && (!!NoteLogic.execArgv(t.exec) || store.hasAction(t, "default")))
      if (what === "none") return "none"
      if (what === "keyboard") return keyboard()
      if (what === "activate") return invokeLast()
      if (what === "press") store.runAction(t, buttons[0].id)
      else store.toasts.dismissToast()
      return "ok"
    }
    // Omarchy 4.5 (Super + Strg + Komma): the open view, the newest
    // notification's first button focused; Tab, Enter and Escape as always.
    function keyboard(): string {
      if (store.app.opened) { store.app.opened = false; return "off" }
      if (store.app.veiled) return "none"
      if (store.app.mode === "toast") store.toasts.next()
      store.app.keysAsked = true
      store.app.opened = true
      store.keyboardFocus()
      return "on"
    }
    // Button n (from 1) of the newest pop-up.
    function invokeAction(n: int): string {
      var t = store.app.mode === "toast" ? store.toasts.toast : null
      var b = t && t.note ? store.liveActions(t)[n - 1] : null
      if (!b) return "none"
      store.runAction(t, b.id)
      return "ok"
    }
    function count(): string { return String((store.toasts.toast ? 1 : 0) + store.toasts.queue.length) }
    // Takes pop-ups off the screen by title substring (first-run hints).
    function dismiss(summary: string): string {
      var needle = String(summary || "")
      if (!needle) return "none"
      return store.toasts.dismissTitled(needle) ? "ok" : "none"
    }
  }
}
