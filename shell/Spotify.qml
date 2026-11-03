import QtQuick
import Quickshell
import Quickshell.Io
import Quickshell.Services.Mpris
import "PlayerLogic.js" as PlayerLogic
import "ProbeLogic.js" as ProbeLogic

// Spotify's "+" in the player window (#121): whether the user connected
// their own Spotify app (settings page), and for the playing Spotify track
// whether it is in their Liked Songs. bin/omarchy-buddy-spotify does the
// talking and keeps the tokens; this file only sees its answers.
// Not connected (#162), the "+" sends Spotify's own shortcut for "Like"
// (Alt+Shift+B, toggles) to the window of Spotify's desktop app; the
// island then cannot know whether the track is saved.
Scope {
  id: spotify
  required property var app
  property bool connected: false
  property string clientId: ""        // the one used last (no secret), for the page's field
  property bool connecting: false
  property string connectError: ""    // the helper's code from the last connecting
  property var answer: null           // the last reply for a track: { uri, saved } or { uri, error }
  readonly property string helper: app.repo + "/bin/omarchy-buddy-spotify"
  property string redirect: ""        // what the user enters on developer.spotify.com
  readonly property string uri: app.player.current ? PlayerLogic.spotifyTrack(app.player.current.metadata) : ""
  readonly property bool desktopApp: !!app.player.current && PlayerLogic.spotifyApp(app.player.current.dbusName)
  property var hyprctl: ["hyprctl"]   // tests/fake-hyprctl in tests/live and tests/gallery
  // The cover's click (#199): Spotify's window comes up, the island closes like "Zum Fenster".
  function raise() {
    Quickshell.execDetached(hyprctl.concat(["dispatch", PlayerLogic.spotifyFocus]))
    app.opened = false
  }
  property string window: ""          // the address of Spotify's window, "" for none or after an error
  property string sent: ""            // the track the shortcut was just sent for (the short feedback)
  // The settings show the Spotify section once a Spotify player ran (kept in
  // ui.json, test players aside) or while connected (#163).
  property var testSeen: null         // tests/gallery: true/false instead of ui.json, in memory only
  readonly property bool seen: connected || (testSeen === null ? app.prefs.spotifySeen : testSeen)
  readonly property bool running: {
    var list = Mpris.players.values
    for (var i = 0; i < list.length; i++)
      if (!ProbeLogic.isTest({ app: String(list[i].identity) }) && PlayerLogic.isSpotify(list[i].dbusName, list[i].metadata)) return true
    return false
  }
  readonly property bool remember: running && app.prefs.loaded && !app.prefs.spotifySeen
  // later: setting it at once changes `remember` while it is being handled (a binding loop)
  onRememberChanged: if (remember) Qt.callLater(function() { spotify.app.prefs.set("spotifySeen", true) })

  readonly property string like: PlayerLogic.likeState(connected, uri, answer, ask.running,
    { app: desktopApp, window: window, busy: press.running, sent: sent })

  // Asked once per track, while the window shows.
  readonly property bool wanted: connected && uri !== "" && app.player.shown && (!answer || answer.uri !== uri)
  onWantedChanged: if (wanted) Qt.callLater(check)

  // Not connected: Spotify's window looked up once per track, while the window shows.
  readonly property string seek: !connected && desktopApp && uri !== "" && app.player.shown ? uri : ""
  onSeekChanged: if (seek !== "") Qt.callLater(look)
  function look() {
    if (find.running) { find.again = true; return }
    if (seek === "") return
    find.command = hyprctl.concat(["clients", "-j"])
    find.running = true
  }
  function toggle() {
    var dispatch = PlayerLogic.likeShortcut(window)
    if (dispatch === "" || press.running) return
    sent = ""
    press.uri = uri
    press.command = hyprctl.concat(["dispatch", dispatch])
    press.running = true
  }

  function check() { if (wanted && !ask.running) run(["check", uri]) }
  function save() { if (uri !== "" && !ask.running) run(["save", uri]) }
  function remove() { if (uri !== "" && !ask.running) run(["remove", uri]) }
  function retry() { answer = null; check() }
  function run(args) {
    ask.command = [helper].concat(args)
    ask.running = true
  }

  function connect(id) {
    if (connecting) return
    connectError = ""
    connecting = true
    if (String(id || "").trim() !== "") clientId = String(id).trim()
    login.command = [helper, "connect", clientId]
    login.running = true
  }
  function cancelConnect() { connecting = false; login.signal(15) }
  function disconnect() {
    Quickshell.execDetached([helper, "disconnect"])
    connected = false
    answer = null
  }

  Process {
    running: true
    command: [spotify.helper, "status"]
    stdout: StdioCollector {
      onStreamFinished: {
        var r = PlayerLogic.helperReply(text)
        spotify.connected = r.connected === true
        spotify.clientId = String(r.clientId || "")
        spotify.redirect = String(r.redirect || "")
      }
    }
  }
  Process {
    id: ask
    stdout: StdioCollector { onStreamFinished: spotify.answer = PlayerLogic.helperReply(text) }
  }
  Process {
    id: find
    property bool again: false  // asked again while it ran (tests/live switched to the fake hyprctl)
    onExited: if (again) { again = false; spotify.look() }
    stdout: StdioCollector {
      onStreamFinished: {
        if (find.again) return
        var clients = null
        try { clients = JSON.parse(text) } catch (e) {}
        spotify.window = PlayerLogic.spotifyWindow(clients, spotify.app.player.current ? String(spotify.app.player.current.trackTitle || "") : "")
      }
    }
  }
  Process {
    id: press
    property string uri: ""
    // Hyprland answers "ok", or a warning when the window is gone: then no "+".
    stdout: StdioCollector {
      onStreamFinished: {
        if (text.trim() === "ok") { spotify.sent = press.uri; feedback.restart() }
        else spotify.window = ""
      }
    }
  }
  Timer { id: feedback; interval: 4000; onTriggered: spotify.sent = "" }
  Process {
    id: login
    stdout: StdioCollector {
      onStreamFinished: {
        if (!spotify.connecting) return  // cancelled from the page
        var r = PlayerLogic.helperReply(text)
        spotify.connecting = false
        if (r.connected === true) { spotify.connected = true; spotify.answer = null; spotify.connectError = "" }
        else spotify.connectError = r.error || "failed"
      }
    }
  }
}
