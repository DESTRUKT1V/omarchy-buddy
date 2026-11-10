import QtQuick
import Quickshell
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
  property bool disconnecting: false  // "Trennen" runs: connected until the helper confirms (#253)
  property int epoch: 0               // +1 on every account change: a track reply from before is dropped
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

  readonly property string like: PlayerLogic.likeState(connected, uri, answer, ask.active,
    { app: desktopApp, window: window, busy: press.active, sent: sent })

  // Asked once per track, while the window shows.
  readonly property bool wanted: connected && !disconnecting && uri !== "" && app.player.shown && (!answer || answer.uri !== uri)
  onWantedChanged: if (wanted) Qt.callLater(check)

  // Not connected: Spotify's window looked up once per track, while the window shows.
  readonly property string seek: !connected && desktopApp && uri !== "" && app.player.shown ? uri : ""
  onSeekChanged: if (seek !== "") Qt.callLater(look)
  function look() {
    if (find.active) { find.again = true; return }
    if (seek === "") return
    find.argv = hyprctl.concat(["clients", "-j"])
    find.start()
  }
  function toggle() {
    var dispatch = PlayerLogic.likeShortcut(window)
    if (dispatch === "" || press.active) return
    sent = ""
    press.uri = uri
    press.argv = hyprctl.concat(["dispatch", dispatch])
    press.start()
  }

  function check() { if (wanted && !ask.active) run(["check", uri]) }
  function save() { if (uri !== "" && !ask.active) run(["save", uri]) }
  function remove() { if (uri !== "" && !ask.active) run(["remove", uri]) }
  function retry() { answer = null; check() }
  function run(args) {
    ask.epoch = epoch
    ask.uri = uri
    ask.argv = [helper].concat(args)
    ask.start()
  }

  function connect(id) {
    if (connecting || disconnecting) return
    connectError = ""
    connecting = true
    if (String(id || "").trim() !== "") clientId = String(id).trim()
    login.argv = [helper, "connect", clientId]
    login.request()  // a cancelled one may still be ending: right after it
  }
  function cancelConnect() { connecting = false; login.queued = false; login.cancelled = true; login.signal(15) }
  function disconnect() {
    if (disconnecting || connecting) return
    disconnecting = true
    leave.start()
  }
  function changed() { epoch++; answer = null }

  // Finite helpers (Helper.qml, #255): a reply counts only when the helper
  // ran to its end (it always ends with 0 and one JSON line); otherwise
  // "failed", which the window and the settings page offer to try again.
  Helper {
    id: query
    argv: [spotify.helper, "status"]
    Component.onCompleted: start()
    onDone: (result, output) => {
      if (result !== "ok") return  // reads a file only: what is known stays
      var r = PlayerLogic.helperReply(output)
      spotify.connected = r.connected === true
      spotify.clientId = String(r.clientId || "")
      spotify.redirect = String(r.redirect || "")
    }
  }
  Helper {
    id: ask
    property int epoch: 0
    property string uri: ""
    seconds: 60  // a token refresh and the request, 10 s each, behind the lock
    onDone: (result, output) => {
      // Always for the track asked about, so a failure shows (and is not asked again at once).
      var r = PlayerLogic.helperReply(result === "ok" ? output : "")
      if (ask.epoch === spotify.epoch) spotify.answer = Object.assign({ uri: ask.uri }, r)
      // A reply dropped after an account change: ask again for the playing track.
      if (spotify.wanted) Qt.callLater(spotify.check)
    }
  }
  Helper {
    id: leave
    argv: [spotify.helper, "disconnect"]
    onDone: (result, output) => {
      spotify.disconnecting = false
      // Not confirmed (the helper failed): still connected, "Trennen" can be pressed again.
      if (result === "ok" && PlayerLogic.helperReply(output).connected === false) { spotify.connected = false; spotify.changed() }
    }
  }
  Helper {
    id: find
    property bool again: false  // asked again while it ran (tests/live switched to the fake hyprctl)
    seconds: 10
    limit: 1 << 20  // every window's details
    onDone: (result, output) => {
      if (find.again) { find.again = false; spotify.look(); return }
      var clients = null
      if (result === "ok") try { clients = JSON.parse(output) } catch (e) {}
      spotify.window = PlayerLogic.spotifyWindow(clients, spotify.app.player.current ? String(spotify.app.player.current.trackTitle || "") : "")
    }
  }
  Helper {
    id: press
    property string uri: ""
    seconds: 10
    // Hyprland answers "ok", or a warning when the window is gone: then no "+".
    onDone: (result, output) => {
      if (result === "ok" && output.trim() === "ok") { spotify.sent = press.uri; feedback.restart() }
      else spotify.window = ""
    }
  }
  Timer { id: feedback; interval: 4000; onTriggered: spotify.sent = "" }
  Helper {
    id: login
    property bool cancelled: false
    seconds: 300 + 30  // the helper's WAIT for the browser sign-in, then the token request
    onDone: (result, output) => {
      // Cancelled late, the helper may have stored the tokens already: ask the file.
      if (cancelled) { cancelled = false; query.request(); return }
      if (!spotify.connecting) return
      var r = PlayerLogic.helperReply(result === "ok" ? output : "")
      spotify.connecting = false
      if (r.connected === true) { spotify.connected = true; spotify.changed(); spotify.connectError = "" }
      else spotify.connectError = r.error || "failed"
    }
  }
}
