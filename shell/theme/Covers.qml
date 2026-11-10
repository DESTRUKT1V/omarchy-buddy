pragma Singleton

import QtQuick
import Quickshell
import Quickshell.Io
import "../PlayerLogic.js" as PlayerLogic

// Covers from the net for every Thumbnail (#251): a music player's artUrl
// reaches Qt's Image only as the checked local file bin/omarchy-buddy-cover
// fetched (bounded in bytes and time, https only, the address on stdin). One fetch at a time, at
// most PlayerLogic.coverQueueMax waiting; until a cover is there, or when it
// failed, Thumbnail shows its placeholder. (In theme/ for its qmldir: the
// plugin's only singletons live there.)
Singleton {
  id: covers
  property var known: ({})   // PlayerLogic.coverKnown
  property var queue: []
  property string busy: ""   // the address being fetched
  readonly property string helper: decodeURIComponent(String(Qt.resolvedUrl("../../bin/omarchy-buddy-cover")).replace(/^file:\/\//, ""))

  function source(url) { return PlayerLogic.coverSource(url, known) }
  function want(url) {
    if (!PlayerLogic.coverWanted(url, known, queue.concat(busy ? [busy] : []), Date.now())) return
    queue = PlayerLogic.coverQueued(queue, String(url))
    next()
  }
  function next() {
    if (busy || fetch.running || !queue.length) return
    busy = queue[0]
    queue = queue.slice(1)
    fetch.command = [helper]
    fetch.stdinEnabled = true
    fetch.running = true
    guard.restart()
  }
  function done(url, path) {
    if (url !== busy) return
    busy = ""
    guard.stop()
    known = PlayerLogic.coverKnown(known, url, path, Date.now())
    Qt.callLater(next)
  }

  // The address on stdin, never as an argument: it tells what plays (#219).
  Process {
    id: fetch
    onStarted: { write(covers.busy + "\n"); stdinEnabled = false }
    stdout: StdioCollector { onStreamFinished: covers.done(covers.busy, PlayerLogic.coverPath(text)) }
    // Ended (or never started) without an answer: settle gives the output a moment to arrive.
    onRunningChanged: if (!running) { if (covers.busy) { settle.url = covers.busy; settle.restart() } else covers.next() }
  }
  Timer { id: settle; property string url; interval: 500; onTriggered: { covers.done(url, ""); covers.next() } }
  // The helper ends itself after 12 s; this ends it if not.
  Timer { id: guard; interval: 15000; onTriggered: { fetch.running = false; covers.done(covers.busy, "") } }
}
