import QtQuick
import Quickshell
import Quickshell.Io
import "ToastLogic.js" as ToastLogic
import "theme"

// News from omarchy-buddy-say and omarchy-buddy-feed (system, coding, Kuma,
// GitHub, agents' errors; a finished run only pops up) in ~/.local/state/omarchy-buddy/news.json, with
// "Verlauf speichern: gar nicht" in $XDG_RUNTIME_DIR/omarchy-buddy (memory
// only). New items pop up unless the user is already looking at them.
Scope {
  id: feed
  required property var app

  property var items: []
  property string raw: ""
  property real lastToasted: -1
  property var unfolded: ({})  // the days (#183) and cut-off texts (#248, "news|ID") the user opened, until it closes
  readonly property string historyMode: app.settings.values.history

  // The setting changed: lib/buddy.py moves the news to the place it wants
  // (both files together, nothing twice) and empties the other one.
  onHistoryModeChanged: place()
  function place() {
    if (placeRun.active) return
    placeRun.mode = historyMode
    placeRun.start()
  }

  // "jetzt prüfen" (ToastLogic.checkLabel)
  property real checkStarted: 0
  property bool checkDone: false
  property bool checkFailed: false
  readonly property bool checking: feedRun.active
  readonly property string checkLabel: ToastLogic.checkLabel({ running: checking, done: checkDone, failed: checkFailed,
                                                               found: ToastLogic.newSince(items, checkStarted) }, Theme.lang)

  function checkNow() {
    if (checking) return
    checkStarted = Date.now() / 1000
    checkDone = false
    feedRun.start()
    app.playEmote("talk", 1200)
  }

  function load(text) {
    text = String(text || "[]")
    if (text === raw) return
    raw = text
    var list = ToastLogic.parseNews(text)
    var newest = ToastLogic.newest(list)
    if (lastToasted < 0) {
      // First read after a shell start: don't replay old items.
      lastToasted = newest
    } else {
      var fresh = ToastLogic.freshNews(list, lastToasted, function(item) {
        return ToastLogic.watching(item, app.away, function(w) { return app.windowFocused(w) })
      })
      if (fresh.length) { app.toasts.enqueue(fresh); lastToasted = newest; app.touch() }
    }
    items = ToastLogic.listed(list)
  }

  FileView {
    id: newsFile
    path: feed.app.ready ? (feed.historyMode === "off" ? feed.app.runDir : feed.app.stateDir) + "/news.json" : ""
    watchChanges: true
    printErrors: false
    onLoaded: feed.load(text())
    onLoadFailed: feed.load("[]")
    onFileChanged: reload()
  }
  // Finite helpers (Helper.qml, #255). The feed has no overall deadline of
  // its own (only per step, the longest the Rückfall check with 600 s): its
  // timer's 15 minutes. One that did not get through says so; the link
  // ("jetzt prüfen") tries again.
  Helper {
    id: feedRun
    argv: [feed.app.feeder, "--now"]
    seconds: 900
    onDone: result => {
      newsFile.reload()
      feed.checkDone = true
      feed.checkFailed = result !== "ok"
      checkShown.restart()
    }
  }
  Helper {
    id: placeRun
    property string mode
    argv: ["python3", feed.app.repo + "/lib/buddy.py", "news", mode]
    onDone: result => {
      newsFile.reload()
      // A pop-up names buddy.py (not python3); the next change of the setting tries again.
      if (result !== "ok") feed.app.helperFailed(argv.slice(1), result)
      if (mode !== feed.historyMode) feed.place()
    }
  }
  Timer { id: checkShown; interval: ToastLogic.checkShowMs; onTriggered: feed.checkDone = false }

  // Safety net for atomic replaces the watcher misses.
  Timer {
    interval: 15000
    running: true
    repeat: true
    onTriggered: newsFile.reload()
  }
}
