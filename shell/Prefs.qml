import QtQuick
import Quickshell
import Quickshell.Io
import "IslandLogic.js" as IslandLogic

// ~/.local/state/omarchy-buddy/ui.json: the island's state, not settings (those
// are in Settings.qml): what the user has read (up to a time, and pop-ups they
// saw after it), what is done for "Für dich" (#178, apart from read: ids and
// times only), the Ruhemodus, whether a Spotify player ran once and the
// first minutes (#192: greeted, a session seen). Until #81
// ui.json held the settings too; Settings.qml takes them from `uiText`
// once, and the next save leaves them out.
Scope {
  id: prefs
  required property var app

  property real lastRead: 0
  property var readIds: ({})       // pop-ups seen after lastRead: id → time (IslandLogic.readBy)
  property real doneUpTo: 0
  property var doneIds: ({})       // "Für dich": clicked or taken out after doneUpTo (IslandLogic.doneBy)
  property bool quiet: false       // Ruhemodus, switched by the user
  property bool spotifySeen: false // a Spotify player ran once: the settings show Spotify (#163)
  property real welcomed: 0        // the setup (setup.json "since") O-Morchy greeted for (#192)
  property bool agentsSeen: false  // a session came once: no more "Starte Claude …" (#192)
  property bool loaded: false
  property string uiText: ""       // the file as read at the start

  function save() {
    if (!loaded) return  // never over ui.json before it was read
    uiFile.setText(JSON.stringify({ lastRead: lastRead, readIds: readIds, doneUpTo: doneUpTo, doneIds: doneIds, quiet: quiet, spotifySeen: spotifySeen,
                                    welcomed: welcomed, agentsSeen: agentsSeen }) + "\n")
  }

  function set(name, value) {
    prefs[name] = value
    save()
  }

  function setQuiet(on) {
    set("quiet", !!on)
    app.playEmote(quiet ? "squish" : "wave", 600)
  }

  function load(text) {
    if (loaded) return
    uiText = String(text || "")
    try {
      var ui = JSON.parse(uiText)
      lastRead = Number(ui.lastRead || 0)
      readIds = IslandLogic.addRead(ui.readIds, {}, lastRead)
      // Before #178 "Für dich" ended with read: what was read then stays out.
      doneUpTo = ui.doneUpTo === undefined ? lastRead : Number(ui.doneUpTo || 0)
      doneIds = IslandLogic.addRead(ui.doneIds, {}, doneUpTo)
      quiet = ui.quiet === true
      spotifySeen = ui.spotifySeen === true
      welcomed = Number(ui.welcomed || 0)
      agentsSeen = ui.agentsSeen === true
    } catch (e) {}
    loaded = true
  }

  FileView {
    id: uiFile
    path: prefs.app.ready ? prefs.app.stateDir + "/ui.json" : ""
    printErrors: false
    onLoaded: prefs.load(text())
    onLoadFailed: prefs.load("")
  }
}
