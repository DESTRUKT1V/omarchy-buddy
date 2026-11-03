import QtQuick
import Quickshell
import Quickshell.Io
import "ProbeLogic.js" as ProbeLogic
import "theme"

// The test IPC "omarchy-buddy.test" for tests/live and tests/gallery.
// state() only reads. The functions starting with "test" act, but only on
// notifications a test sent itself (app name "Buddy-Test", see
// ProbeLogic.js) or on what the island merely shows (peek, emote); the user's
// own notifications, sessions and settings stay untouched. layout() measures
// what can be clicked; testClick/testType act like the user, but not on a
// real Claude request (only on sessions "buddy-test-…"). The player window's
// buttons click too; tests/fake-player plays for them.
//
//   qs ipc -p /usr/share/omarchy/shell call omarchy-buddy.test state
Scope {
  id: probe
  required property var app
  required property Item island  // the island's rectangle in Island.qml
  required property Item playerWindow  // the player window beside it
  property var savedSettings: null  // the real settings while testSettings() holds others
  property string testText: ""
  property var savedSpotify: null   // the real Spotify state while testSpotify() holds another
  // Frames the island's window has drawn since the shell started, for tests/gpu.
  property int frames: 0
  Connections { target: probe.island.Window.window; function onFrameSwapped() { probe.frames++ } }

  // While a test clicks and types, the island takes no keys: the user may be
  // typing elsewhere, and a click outside would close what the test opened.
  function drive() { app.testDriving = true; driving.restart() }
  Timer { id: driving; interval: 10000; onTriggered: probe.app.testDriving = false }

  // config.json is read again every 15 s; that must not end a test early.
  Connections {
    target: probe.app.settings
    function onValuesChanged() { probe.holdTest() }
    function onBrokenChanged() { probe.holdTest() }
    function onInvalidChanged() { probe.holdTest() }
  }
  function holdTest() {
    if (testText !== "") Qt.callLater(function() { if (probe.testText !== "") probe.app.settings.apply(probe.testText) })
  }

  // Every visible MouseArea in the island (or the player window), except their own backgrounds.
  function clickables(item, out) {
    if (!item || !item.visible) return out
    if (item instanceof MouseArea && item.parent !== island && item.parent !== playerWindow) out.push(item)
    for (var i = 0; i < item.children.length; i++) clickables(item.children[i], out)
    return out
  }

  function rectOf(item) {
    var r = item.mapToItem(island, 0, 0, item.width, item.height)
    return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) }
  }

  // What a clickable shows: a button's label, a link's name (its text, or
  // what an icon link means: "Nächste Anfrage"), a text or an option.
  function nameOf(area) {
    var v = area.parent
    return String(v.label !== undefined ? v.label : v.name !== undefined ? v.name : v.text !== undefined ? v.text
      : v.modelData && v.modelData.label !== undefined ? v.modelData.label : "")
  }

  // A MouseArea's own `enabled` does not see a greyed-out button around it.
  function usable(item) {
    for (var p = item; p; p = p.parent) if (!p.enabled) return false
    return true
  }

  // Clicks only on test things: no real Claude request is ever answered.
  function mayAct() {
    var ask = app.sessions.currentAsk
    return app.mode !== "needs" || (!!ask && String(ask.session.id).indexOf("buddy-test-") === 0)
  }

  function findArea(name) {
    // The player's buttons only for the test's own player, never the user's music.
    var player = app.player.current
    var areas = clickables(island, [])
    if (player && ProbeLogic.isTest({ app: String(player.identity) })) areas = clickables(playerWindow, areas)
    for (var i = 0; i < areas.length; i++) if (nameOf(areas[i]) === name) return areas[i]
    for (i = 0; i < areas.length; i++) if (name !== "" && nameOf(areas[i]).indexOf(name) === 0) return areas[i]
    return null
  }

  // The first visible item in the tree for which ok(item) holds.
  function first(item, ok) {
    if (!item || !item.visible) return null
    if (ok(item)) return item
    for (var i = 0; i < item.children.length; i++) {
      var found = first(item.children[i], ok)
      if (found) return found
    }
    return null
  }

  function flicks(item, out) {
    if (!item || !item.visible) return out
    if (item instanceof Flickable)
      out.push({ h: Math.round(item.height), contentHeight: Math.round(item.contentHeight), interactive: item.interactive })
    for (var i = 0; i < item.children.length; i++) flicks(item.children[i], out)
    return out
  }

  // Running timers and animations in the island's object tree (Behaviors
  // are not in it; they only run during a change), for the idle cost.
  function running(obj, seen, out) {
    if (!obj || seen.indexOf(obj) !== -1) return out
    seen.push(obj)
    if (obj.running === true && (obj.interval !== undefined || obj.loops !== undefined))
      out.push(String(obj).split("(")[0] + (obj.interval !== undefined ? " " + obj.interval + "ms" : ""))
    var lists = [obj.children, obj.resources, obj.data, [obj.contentItem]]
    for (var l = 0; l < lists.length; l++) {
      try { var n = lists[l] ? lists[l].length : 0 } catch (e) { continue }  // some lists cannot be counted
      for (var i = 0; i < n; i++) running(lists[l][i], seen, out)
    }
    return out
  }

  IpcHandler {
    target: "omarchy-buddy.test"

    function ping(): string { return "ok" }
    function frames(): int { return probe.frames }

    function timers(): string {
      var a = probe.app, seen = [], out = []
      var roots = [a, a.prefs, a.settings, a.sessions, a.news, a.notifications, a.toasts, a.player]
      for (var i = 0; i < roots.length; i++) probe.running(roots[i], seen, out)
      return JSON.stringify(out.sort())
    }

    function state(): string {
      var a = probe.app
      return JSON.stringify(ProbeLogic.snapshot({
        mode: a.mode, emote: a.emote, opened: a.opened, peeking: a.peeking, quiet: a.prefs.quiet, sharing: a.sharing,
        silent: a.silent, veiled: a.veiled, settingsShown: a.settingsShown,
        settings: a.settings.values, settingsBroken: a.settings.broken, settingsInvalid: a.settings.invalid, away: a.away, fullscreen: a.fullscreen, paused: a.paused,
        toast: a.toasts.toast, queue: a.toasts.queue, heldBack: a.toasts.heldBack,
        notes: a.notifications.notes, ask: a.sessions.currentAsk, asks: a.sessions.asks,
        sessions: a.sessions.sessions, news: a.news.items,
        player: a.player.current ? { id: String(a.player.current.dbusName), identity: String(a.player.current.identity),
                                     title: String(a.player.current.trackTitle), playing: a.player.current.isPlaying,
                                     shown: probe.playerWindow.visible,
                                     trackid: String((a.player.current.metadata || {})["mpris:trackid"]) } : null,
        spotify: { connected: a.spotify.connected, uri: a.spotify.uri, like: a.spotify.like, seen: a.spotify.seen }
      }, function(key) { return a.notifications.live(key) }))
    }

    // What has the keyboard focus inside the island (a clickable's name), "" if nothing there.
    function focused(): string {
      var item = probe.island.Window.activeFocusItem
      return item instanceof MouseArea ? probe.nameOf(item) : ""
    }

    // Every clickable thing the island shows and whether it can be reached
    // (inside the island and the window, or by scrolling), see ProbeLogic.layout.
    function layout(): string {
      var win = probe.island.parent
      var winRect = { x: -Math.round(probe.island.x), y: -Math.round(probe.island.y), w: Math.round(win.width), h: Math.round(win.height) }
      var islandRect = { x: 0, y: 0, w: Math.round(probe.island.width), h: Math.round(probe.island.height) }
      var areas = probe.clickables(probe.island, [])
      var items = []
      for (var i = 0; i < areas.length; i++) {
        var v = areas[i].parent
        var clips = []
        for (var p = v.parent; p && p !== probe.island; p = p.parent)
          if (p.clip || p instanceof Flickable) clips.push({ rect: probe.rectOf(p), flick: p instanceof Flickable, interactive: p.interactive === true })
        clips.push({ rect: islandRect }, { rect: winRect })
        items.push({ name: probe.nameOf(areas[i]), enabled: probe.usable(areas[i]), rect: probe.rectOf(v), clips: clips,
                     truncated: v.truncated === true })
      }
      return JSON.stringify(ProbeLogic.layout({ mode: probe.app.mode, island: islandRect, window: winRect, items: items,
                                                flicks: probe.flicks(probe.island, []) }))
    }

    // A click on the clickable thing with this name (exactly, or the first
    // one starting with it), as if the user clicked it.
    function testClick(name: string): string {
      var area = probe.mayAct() ? probe.findArea(name) : null
      if (!area || !probe.usable(area)) return "none"
      probe.drive()
      area.clicked(null)
      return "ok"
    }

    // Text in the open text field (own answer, plan feedback, reply), then Enter.
    function testType(text: string): string {
      var input = probe.mayAct() ? probe.first(probe.island, function(i) { return i instanceof TextInput }) : null
      if (!input) return "none"
      probe.drive()
      input.text = text
      input.accepted()
      return "ok"
    }

    // Other settings for a while, as if config.json held this text (also a
    // broken one); nothing is written. "" puts the real ones back.
    function testSettings(text: string): string {
      var s = probe.app.settings
      if (text.trim() === "") {
        probe.testText = ""
        if (!probe.savedSettings) return "none"
        s.values = probe.savedSettings.values; s.extra = probe.savedSettings.extra
        s.invalid = probe.savedSettings.invalid; s.broken = probe.savedSettings.broken
        probe.savedSettings = null
        return "ok"
      }
      if (!probe.savedSettings) probe.savedSettings = { values: s.values, extra: s.extra, invalid: s.invalid, broken: s.broken }
      probe.testText = text
      s.apply(text)
      return "ok"
    }

    // An action button on a test notification, as if clicked.
    function testAction(key: string, id: string): string {
      var n = ProbeLogic.testNote(probe.app.notifications.notes, key)
      if (!n) return "none"
      return probe.app.notifications.invokeAction(n, id) ? "ok" : "none"
    }

    // An inline reply to a test notification, as if typed and sent.
    function testReply(key: string, text: string): string {
      var n = ProbeLogic.testNote(probe.app.notifications.notes, key)
      if (!n || !probe.app.notifications.live(key)) return "none"
      probe.app.notifications.sendReply(n, text)
      return "ok"
    }

    // Takes every test notification off the screen and out of the history.
    function testForget(): string {
      var store = probe.app.notifications
      var toasts = probe.app.toasts
      var groups = ProbeLogic.testGroups(store.notes)
      toasts.queue = toasts.queue.filter(function(t) { return !ProbeLogic.isTest(t) })
      toasts.heldBack = toasts.heldBack.filter(function(t) { return !ProbeLogic.isTest(t) })
      if (ProbeLogic.isTest(toasts.toast)) toasts.next()
      for (var i = 0; i < groups.length; i++) store.removeGroup(groups[i])
      return String(groups.length)
    }

    // The settings page in the open view, for the gallery (shows, changes nothing).
    function testSettingsPage(on: bool): void {
      probe.drive()
      if (on) probe.app.opened = true
      probe.app.settingsShown = on
    }

    // The settings page's own news sources (#164) in another state:
    // {"kuma": a SettingsLogic.kumaNote state, "gh": signed in};
    // "" checks them again for real.
    function testSources(text: string): string {
      var s = probe.app.settings
      if (text.trim() === "") { s.checkSources(); return "ok" }
      var t
      try { t = JSON.parse(text) } catch (e) { return "invalid" }
      if (t.kuma !== undefined) s.kumaCheck = String(t.kuma)
      if (t.gh !== undefined) s.ghSignedIn = t.gh === true
      return "ok"
    }

    // Spotify's "+" and the settings page's Spotify part in another state
    // ({"connected", "answer", "connecting", "connectError", "hyprctl", "seen"
    // (whether a Spotify player ran, #163)}; the
    // answer's uri "current" stands for the playing track; "hyprctl" is
    // tests/fake-hyprctl's command, #162), for tests/gallery and tests/live;
    // "" puts the real one back. Only in memory, nothing reaches Spotify.
    function testSpotify(text: string): string {
      var s = probe.app.spotify
      if (text.trim() === "") {
        if (!probe.savedSpotify) return "none"
        s.answer = probe.savedSpotify.answer; s.connected = probe.savedSpotify.connected
        s.connecting = probe.savedSpotify.connecting; s.connectError = probe.savedSpotify.connectError
        s.hyprctl = probe.savedSpotify.hyprctl; s.window = ""; s.sent = ""; s.testSeen = null; s.look()
        probe.savedSpotify = null
        return "ok"
      }
      var t
      try { t = JSON.parse(text) } catch (e) { return "invalid" }
      if (!probe.savedSpotify) probe.savedSpotify = { answer: s.answer, connected: s.connected, connecting: s.connecting, connectError: s.connectError, hyprctl: s.hyprctl }
      if (Array.isArray(t.hyprctl)) { s.hyprctl = t.hyprctl; s.window = ""; s.sent = "" }
      if (t.answer && t.answer.uri === "current") t.answer.uri = s.uri
      s.answer = t.answer || null  // first: with an answer for the track, nothing asks Spotify
      s.connecting = t.connecting === true
      s.connectError = String(t.connectError || "")
      s.connected = t.connected === true
      s.testSeen = typeof t.seen === "boolean" ? t.seen : null
      s.look()
      return "ok"
    }

    // The first scrolling list in the island to its end (the settings
    // page's lower part), for the gallery.
    function testScrollEnd(): string {
      var flick = probe.first(probe.island, function(i) { return i instanceof Flickable && i.interactive })
      if (!flick) return "none"
      flick.contentY = Math.max(0, flick.contentHeight - flick.height)
      return "ok"
    }

    // The scrolling view brings the clickable thing with this name (as
    // testClick) into sight, a third from the top, for the gallery.
    function testScrollTo(name: string): string {
      var area = probe.findArea(name)
      for (var p = area ? area.parent : null; p; p = p.parent) {
        if (!(p instanceof Flickable)) continue
        p.contentY = Math.max(0, Math.min(p.contentHeight - p.height, area.mapToItem(p.contentItem, 0, 0).y - p.height / 3))
        return "ok"
      }
      return "none"
    }

    // The island as if the screen were shared (quiet and veiled as set),
    // for the gallery; the next screencast event from Hyprland wins.
    function testSharing(on: bool): void {
      probe.app.screencasts = on ? 1 : 0
      probe.app.sharing = on
    }

    // The island in other colours ({"foreground", "background", "accent",
    // "urgent"} as JSON, e.g. a light theme's), for the gallery; "" puts the
    // theme's back. Only the island, only in memory.
    function testColors(text: string): string {
      try { Theme.testColors = text.trim() === "" ? null : JSON.parse(text) } catch (e) { return "invalid" }
      return "ok"
    }

    // The weather (#184) in another state, for tests/looks: {"data": as
    // WeatherLogic.combine makes it, its times in seconds from now,
    // "failed", "placeFailed", "tell": its severe warnings into the news}; "" fetches the real one again. Only in memory.
    function testWeather(text: string): string {
      var w = probe.app.weather
      if (text.trim() === "") { w.testing = false; w.report = null; w.failed = false; w.placeFailed = false; w.refresh(); return "ok" }
      var t
      try { t = JSON.parse(text) } catch (e) { return "invalid" }
      var now = Date.now() / 1000, d = t.data || null
      if (d) {
        d.time += now
        if (d.rain) d.rain.frames.forEach(function(f) { f.t += now })
        if (d.hours) d.hours.forEach(function(h) { h.t += now })
        ;(d.alerts || []).forEach(function(a) { if (a.onset !== null) a.onset += now; if (a.expires !== null) a.expires += now })
      }
      w.testing = true
      w.failed = t.failed === true
      w.placeFailed = t.placeFailed === true
      w.report = d
      probe.app.now = now
      if (t.tell) w.tell()
      return "ok"
    }

    // Peek and O-Morchy's emotes, for the gallery.
    function testPeek(on: bool): void { probe.app.peeking = on }
    function testEmote(name: string): void { probe.app.playEmote(name, 3000) }
  }
}
