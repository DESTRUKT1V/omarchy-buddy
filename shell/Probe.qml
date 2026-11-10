import QtQuick
import Quickshell
import Quickshell.Io
import "ProbeLogic.js" as ProbeLogic
import "theme"

// The test IPC "omarchy-buddy.test" for tests/live and tests/gallery.
// state() only reads. The functions starting with "test" act, but only on
// notifications a test sent itself (app name "Buddy-Test", keys
// "buddy-test-…", see ProbeLogic.js) or on what the island merely shows
// (peek, emote); the user's own notifications, sessions and settings stay
// untouched. layout() measures what can be clicked; testClick/testType act
// like the user, but only on the one test session, record or part the test
// names, checked in the same call, in every view (ProbeLogic.allows). The
// player window's buttons only for tests/fake-player.
//
// A test run (testBegin … testEnd) stops for good as soon as something real
// gets in the way (ProbeLogic.interruption): from then on every action
// answers "interrupted:<why>" and the test's settings and Spotify state go
// back at once; the test cleans up its own things and tries again later.
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
  property bool run: false          // a test run is on (testBegin)
  property string stopped: ""       // why it stopped (ProbeLogic.interruption), "" while it goes on
  property bool acting: false       // inside a test action: what opens now, the test opened
  property bool viewByTest: false   // the open view / settings page came from the test, not the user
  property bool settingsByTest: false
  property var known: null          // the real records at the start (ProbeLogic.realKeys)
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

  function act(fn) {
    acting = true
    try { return fn() } finally { acting = false }
  }

  function facts() {
    var a = app
    return { asks: a.sessions.asks, toast: a.toasts.toast, queue: a.toasts.queue, heldBack: a.toasts.heldBack,
             opened: a.opened, viewByTest: viewByTest, settingsShown: a.settingsShown, settingsByTest: settingsByTest,
             paused: a.paused, known: known, records: a.notifications.notes.concat(a.news.items) }
  }

  // Something real in the way ends the run at once, also between two calls.
  function watch() {
    if (!run || stopped) return
    var why = ProbeLogic.interruption(facts())
    if (!why) return
    stopped = why
    restoreTest()
  }
  // "" or why the test must not act now.
  function blocked() { watch(); return run && stopped ? "interrupted:" + stopped : "" }

  // The settings and Spotify state the user may now see are their own again.
  function restoreTest() { restoreSettings(); restoreSpotify() }
  function restoreSettings() {
    if (savedSettings) {
      var s = app.settings
      testText = ""
      s.values = savedSettings.values; s.extra = savedSettings.extra
      s.invalid = savedSettings.invalid; s.broken = savedSettings.broken; s.held = false
      savedSettings = null
    }
  }
  function restoreSpotify() {
    if (savedSpotify) {
      var p = app.spotify
      p.answer = savedSpotify.answer; p.connected = savedSpotify.connected
      p.connecting = savedSpotify.connecting; p.connectError = savedSpotify.connectError
      p.hyprctl = savedSpotify.hyprctl; p.window = ""; p.sent = ""; p.testSeen = null; p.look()
      savedSpotify = null
    }
  }

  Connections {
    target: probe.app
    function onOpenedChanged() { probe.viewByTest = probe.app.opened && probe.acting; probe.watch() }
    function onSettingsShownChanged() { probe.settingsByTest = probe.app.settingsShown && probe.acting; probe.watch() }
    function onPausedChanged() { probe.watch() }
  }
  Connections {
    target: probe.app.sessions
    function onAsksChanged() { probe.watch() }
  }
  Connections {
    target: probe.app.notifications
    function onNotesChanged() { probe.watch() }
  }
  Connections {
    target: probe.app.news
    function onItemsChanged() { probe.watch() }
  }
  Connections {
    target: probe.app.toasts
    function onToastChanged() { probe.watch() }
    function onQueueChanged() { probe.watch() }
    function onHeldBackChanged() { probe.watch() }
  }

  function clearTest() {
    var toasts = app.toasts
    toasts.queue = toasts.queue.filter(function(t) { return !ProbeLogic.isTest(t) })
    toasts.heldBack = toasts.heldBack.filter(function(t) { return !ProbeLogic.isTest(t) })
    if (ProbeLogic.isTest(toasts.toast)) toasts.next()  // the queue holds no test pop-up now
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

  // Whose thing an item acts on (ProbeLogic.owner), read from it and its parents.
  function ownerOf(item) {
    var levels = []
    for (var p = item; p && p !== island; p = p.parent) {
      if (p === playerWindow) { levels.push({ marker: "player" }); break }
      levels.push({ marker: p.probeOwner, ask: p.ask, session: p.session, note: p.note !== undefined ? p.note : p instanceof Loader ? null : p.item,
                    model: p.modelData })
    }
    return ProbeLogic.owner(levels)
  }

  // May the test act on this item for `want` (ProbeLogic.allows)? Read at the moment of acting.
  function owned(item, want) {
    var n = app.notifications, player = app.player.current
    return ProbeLogic.allows(ownerOf(item), want, { notes: n.notes, removed: n.removed, canUndo: n.canUndo,
      testPlayer: !!player && ProbeLogic.isTest({ app: String(player.identity) }) })
  }

  // The clickable with this name (exactly, else the first starting with it) that acts on `want`.
  function findArea(name, want) {
    var areas = clickables(playerWindow, clickables(island, []))
    for (var i = 0; i < areas.length; i++) if (nameOf(areas[i]) === name && owned(areas[i], want)) return areas[i]
    for (i = 0; i < areas.length; i++) if (name !== "" && nameOf(areas[i]).indexOf(name) === 0 && owned(areas[i], want)) return areas[i]
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

    // A test run: "ok", or why not now (ProbeLogic.interruption; the view has to be closed).
    function testBegin(): string {
      probe.run = false
      probe.viewByTest = false
      probe.settingsByTest = false
      probe.known = null
      var why = ProbeLogic.interruption(probe.facts())
      if (why) return why
      probe.known = ProbeLogic.realKeys(probe.app.notifications.notes.concat(probe.app.news.items))
      probe.stopped = ""
      probe.run = true
      return "ok"
    }
    function testEnd(): void { probe.run = false; probe.stopped = "" }
    // Why the run stopped, "" while it goes on.
    function testInterrupted(): string { probe.watch(); return probe.stopped }
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
    // one starting with it) that acts on `owner` (a test session's id, a test
    // record's key, "history", "view" or "player"), as if the user clicked it.
    function testClick(name: string, owner: string): string {
      var why = probe.blocked()
      if (why) return why
      var area = probe.findArea(name, owner)
      if (!area || !probe.usable(area)) return "none"
      probe.act(function() { probe.drive(); area.clicked(null) })
      return "ok"
    }

    // Text in the open text field of `owner` (own answer, plan feedback), then Enter.
    function testType(text: string, owner: string): string {
      var why = probe.blocked()
      if (why) return why
      var input = probe.first(probe.island, function(i) { return i instanceof TextInput && probe.owned(i, owner) })
      if (!input) return "none"
      probe.act(function() { probe.drive(); input.text = text; input.accepted() })
      return "ok"
    }

    // Omarchy's "notifications" IPC method (act, invokeLast, dismissAll …),
    // but only while everything it would act on is the test's, decided in
    // this call (ProbeLogic.omarchyTargets); "foreign" otherwise.
    function testOmarchy(method: string, arg: string): string {
      var why = probe.blocked()
      if (why) return why
      var t = probe.app.toasts
      var targets = ProbeLogic.omarchyTargets(method, { mode: probe.app.mode, toast: t.toast, queue: t.queue })
      if (!targets || !targets.every(ProbeLogic.isTest)) return "foreign"
      var ipc = probe.app.notifications.omarchyIpc
      return probe.act(function() {
        return method === "invokeAction" ? ipc.invokeAction(Number(arg)) : method === "dismiss" ? ipc.dismiss(arg) : ipc[method]()
      })
    }

    // The open view open or closed, as the test's own; a view the user opened stays.
    function testOpen(on: bool): string {
      if (on) {
        var why = probe.blocked()
        if (why) return why
      } else if (probe.run && probe.app.opened && !probe.viewByTest) return "interrupted:view"
      probe.act(function() { probe.app.opened = on && !probe.app.veiled })
      return "ok"
    }

    // The test's pop-ups off the screen (in the history they stay).
    function testClear(): string { probe.clearTest(); return "ok" }

    // Other settings for a while, as if config.json held this text (also a
    // broken one); nothing is written. "" puts the real ones back.
    function testSettings(text: string): string {
      var s = probe.app.settings
      if (text.trim() === "") {
        if (!probe.savedSettings) return "none"
        probe.restoreSettings()
        return "ok"
      }
      var why = probe.blocked()
      if (why) return why
      if (!probe.savedSettings) probe.savedSettings = { values: s.values, extra: s.extra, invalid: s.invalid, broken: s.broken }
      s.held = true
      probe.testText = text
      s.apply(text)
      return "ok"
    }

    // An action button on a test notification, as if clicked.
    function testAction(key: string, id: string): string {
      var why = probe.blocked()
      if (why) return why
      var n = ProbeLogic.testNote(probe.app.notifications.notes, key)
      if (!n) return "none"
      return probe.app.notifications.invokeAction(n, id) ? "ok" : "none"
    }

    // An inline reply to a test notification, as if typed and sent.
    function testReply(key: string, text: string): string {
      var why = probe.blocked()
      if (why) return why
      var n = ProbeLogic.testNote(probe.app.notifications.notes, key)
      if (!n || !probe.app.notifications.live(key)) return "none"
      probe.app.notifications.sendReply(n, text)
      return "ok"
    }

    // Takes every test notification off the screen and out of the history.
    function testForget(): string {
      var store = probe.app.notifications
      var groups = ProbeLogic.testGroups(store.notes)
      probe.clearTest()
      for (var i = 0; i < groups.length; i++) store.removeGroup(groups[i])
      return String(groups.length)
    }

    // The settings page in the open view, for the gallery (shows, changes nothing).
    function testSettingsPage(on: bool): string {
      if (on) {
        var why = probe.blocked()
        if (why) return why
      } else if (probe.run && probe.app.settingsShown && !probe.settingsByTest) return "interrupted:view"
      probe.act(function() {
        probe.drive()
        if (on) probe.app.opened = true
        probe.app.settingsShown = on
      })
      return "ok"
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
        probe.restoreSpotify()
        return "ok"
      }
      var why = probe.blocked()
      if (why) return why
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
