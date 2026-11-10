import QtQuick
import Quickshell
import Quickshell.Io
import "NoteLogic.js" as NoteLogic
import "ToastLogic.js" as ToastLogic
import "SettingsLogic.js" as SettingsLogic
import "theme"

// The pop-up on screen (`toast`), the ones waiting behind it and those held
// back while the user is away, a fullscreen window covers the island or the
// open view is open. Critical notifications and appointments ("sticky") stay until clicked
// away and survive a shell restart (popups.json); a finished Claude run
// stays until the user has touched mouse or keyboard. Neither holds up the
// ones behind it; the rules are in ToastLogic.js.
Scope {
  id: toasts
  required property var app

  property var toast: null
  property var queue: []
  property var heldBack: []
  property bool restored: false
  property string savedSticky: "[]"
  property bool inputSeen: false  // input since the pop-up on screen appeared

  property real shownAt: 0        // when the pop-up on screen appeared

  onToastChanged: { inputSeen = app.active; shownAt = Date.now(); stickySave.restart() }
  onQueueChanged: stickySave.restart()
  onHeldBackChanged: stickySave.restart()
  // "Verlauf speichern" covers popups.json too (ToastLogic.storedSticky).
  readonly property string historyMode: app.settings.values.history
  onHistoryModeChanged: stickySave.restart()

  function enqueue(items) {
    if (!items.length) return
    if (app.paused || app.opened) {
      var held = heldBack.concat(items)
      heldBack = ToastLogic.hold(heldBack, items, Date.now() / 1000, Theme.lang)
      releaseFolded(held, heldBack)
      return
    }
    var all = queue.concat(items)
    queue = ToastLogic.fold(queue, items, Date.now() / 1000, Theme.lang)
    releaseFolded(all, queue)
    if (!toast) next()
  }

  function next() {
    var gone = toast
    if (!queue.length) toast = null
    else {
      toast = queue[0]
      queue = queue.slice(1)
    }
    if (gone) { left(gone); app.markToastRead(gone) }
  }

  // Pop-ups folded into a summary or dropped leave the screen for good too.
  function releaseFolded(before, after) {
    for (var i = 0; i < before.length; i++) if (after.indexOf(before[i]) === -1) left(before[i])
  }

  // A pop-up left the screen for good. Omarchy's own feedback toasts,
  // transient notifications and music leave nothing behind.
  function left(t) {
    if (app.notifications.replyKey === t.key) app.notifications.replyKey = ""
    if (!NoteLogic.kept(t)) app.notifications.release(t.key, false)
  }

  function onScreen(key) {
    if (toast && toast.key === key) return true
    for (var i = 0; i < queue.length; i++) if (queue[i].key === key) return true
    return false
  }

  function restartTimer() { toastTimer.restart() }

  // The pop-up on screen ran out. Right after a change of pop-up the timer
  // can fire a second time within milliseconds (seen live going from a 5 s
  // "fertig" to an 8 s notification) and would take the new one along; a
  // pop-up never runs out in its first second.
  function timeUp() {
    if (Date.now() - shownAt < 1000) return
    var step = ToastLogic.afterTime(toast, queue)
    toast = step.toast
    queue = step.queue
    if (step.gone) { left(step.gone); app.markToastRead(step.gone) }
  }

  // "Schließen" on a pop-up: closes everything it bundles.
  function dismissToast() {
    if (!toast) return
    if (toast.note) app.notifications.closeBundle(toast)
    next()
  }

  function dismissAll() {
    if (toast) app.markToastRead(toast)
    var all = (toast ? [toast] : []).concat(queue)
    queue = []
    toast = null
    for (var i = 0; i < all.length; i++) left(all[i])
  }

  // Takes the pop-up `key` away wherever it waits (the setup's offer once it ran, #192).
  function withdraw(key) {
    var keep = function(t) { return t.key !== key }
    queue = queue.filter(keep)
    heldBack = heldBack.filter(keep)
    if (toast && toast.key === key) next()
  }

  // Takes pop-ups off the screen by title substring (first-run hints).
  function dismissTitled(needle) {
    var before = queue
    queue = queue.filter(function(t) { return !ToastLogic.hasTitle(t, needle) })
    releaseFolded(before, queue)
    var hit = queue.length !== before.length
    if (toast && ToastLogic.hasTitle(toast, needle)) { dismissToast(); hit = true }
    return hit
  }

  // Leaving: a pop-up still on screen waits for the user's return. Back at the
  // PC (or out of fullscreen): say hello and hand over what happened
  // meanwhile.
  Connections {
    target: toasts.app
    function onPausedChanged() {
      var app = toasts.app
      if (app.paused) {
        var away = ToastLogic.onLeave(toasts.toast, toasts.queue, toasts.heldBack)
        toasts.heldBack = away.heldBack
        toasts.toast = away.toast
        toasts.queue = away.queue
        app.notifications.replyKey = ""
        return
      }
      app.touch()
      if (app.away) return
      var held = toasts.heldBack
      toasts.heldBack = []
      var back = ToastLogic.welcomeBack(held, Date.now() / 1000, Theme.lang)
      toasts.releaseFolded(held, back)
      if (back.length) toasts.enqueue(back)
      else app.playEmote("wave", 1500)
    }
    // Opening: see ToastLogic.onOpen. Closing hands the held-back ones over.
    function onOpenedChanged() {
      var app = toasts.app
      if (app.opened) {
        var open = ToastLogic.onOpen(toasts.toast, toasts.queue, toasts.heldBack)
        toasts.heldBack = open.heldBack
        toasts.queue = open.queue
        if (open.drop) toasts.next()
        return
      }
      if (app.paused || !toasts.heldBack.length) return
      var held = toasts.heldBack
      toasts.heldBack = []
      var after = ToastLogic.afterOpen(held, Date.now() / 1000, Theme.lang)
      toasts.releaseFolded(held, after)
      toasts.enqueue(after)
    }
    function onActiveChanged() { if (toasts.app.active) toasts.inputSeen = true }
  }

  function restore(raw) {
    if (restored) return
    restored = true
    var list = ToastLogic.restoreSticky(raw)
    savedSticky = JSON.stringify(list)
    if (list.length) enqueue(list)
  }

  FileView {
    id: stickyFile
    path: toasts.app.ready ? toasts.app.stateDir + "/popups.json" : ""
    printErrors: false
    onLoaded: toasts.restore(text())
    onLoadFailed: toasts.restore("[]")
  }
  // Written only when the critical ones change, not with every pop-up.
  Timer {
    id: stickySave
    interval: 500
    onTriggered: {
      if (!toasts.restored) return
      var text = JSON.stringify(ToastLogic.storedSticky(ToastLogic.stickyOnes(toasts.toast, toasts.queue, toasts.heldBack),
                                                        toasts.historyMode))
      if (text === toasts.savedSticky) return
      toasts.savedSticky = text
      stickyFile.setText(text + "\n")
    }
  }

  // Runs while a pop-up is visible and not hovered; pausing restarts it.
  // An open reply field stops it; critical notifications and a finished
  // Claude run only run out while others wait (ToastLogic.runsOut).
  Timer {
    id: toastTimer
    repeat: true
    interval: ToastLogic.duration(toasts.toast, SettingsLogic.popupFactor(toasts.app.settings.values.popupTime))
    running: toasts.app.mode === "toast" && !toasts.app.hovered && toasts.app.notifications.replyKey === ""
      && ToastLogic.runsOut(toasts.toast, toasts.queue.length, toasts.inputSeen)
    onTriggered: toasts.timeUp()
  }
}
