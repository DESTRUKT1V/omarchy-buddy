import QtQuick
import Quickshell
import Quickshell.Hyprland
import Quickshell.Io
import Quickshell.Wayland
import qs.Commons
import "theme"
import "views"
import "IslandLogic.js" as IslandLogic
import "SettingsLogic.js" as SettingsLogic
import "ToastLogic.js" as ToastLogic
import "Strings.js" as Strings

// A companion in Omarchy's bar (in the spirit of Coucou and NIO's NOMI). At
// rest it is a bar widget beside the clock (BarWidget.qml, #182) with
// O-Morchy, a pixel blob that breathes, blinks, thinks while an agent works
// and falls asleep when nothing happens or the user is away. Under the bar,
// as an Omarchy pop-up, the island opens as
//   peek   - pointer over the widget: O-Morchy waves, one-line summary
//   toast  - a news item, a desktop notification or a finished session, a
//            few seconds, then back (critical notifications stay)
//   needs  - a Claude session waits for a decision: stays until answered,
//            pages through several requests (subagents ask in parallel)
//   open   - click: sessions plus the news history (Escape, a click
//            elsewhere or on the widget closes it)
//
// This file wires the parts together and holds what they share: which view
// shows, O-Morchy's mood, whether the user is around. The parts:
//   Sessions.qml       Claude sessions and requests (omarchy-buddy-hook's state.json)
//   News.qml           news.json from omarchy-buddy-say and omarchy-buddy-feed
//   Notifications.qml  the desktop's notification server, its history, IPC "notifications"
//   Toasts.qml         the pop-up on screen and those waiting
//   Player.qml         the music player the window beside the open view shows
//   Spotify.qml        Spotify's "+" there (omarchy-buddy-spotify, optional)
//   Weather.qml        the weather under it and at the bar widget (#184, optional)
//   Prefs.qml          ui.json (read up to, Ruhemodus)
//   Settings.qml       config.json (the user's settings, the page behind the gear)
//   Probe.qml          test IPC "omarchy-buddy.test" for tests/live and tests/gallery
//   BarWidget.qml      the widget in the bar (its own entry point, finds this service)
//   views/             Island.qml (the window) and one file per view
//   components/        building blocks: O-Morchy, buttons, labels, pictures
//   theme/Theme.qml    measures, fonts, colours, zoom (singleton)
//   *Logic.js          the rules as pure functions, tested in tests/*.test.js
//
// Cost: the layer surface is only as tall as the view shown and as wide as
// the open view with the player (not the screen width), the ticker scrolls
// once per text, O-Morchy repaints only when its pose actually changes, and every
// animation timer stops while the user is away, the screen is locked or a
// fullscreen window covers the island. Only size changes animate per frame.
Item {
  id: buddy

  readonly property string home: Quickshell.env("HOME")
  readonly property string runDir: (Quickshell.env("XDG_RUNTIME_DIR") || "/run/user/1000") + "/omarchy-buddy"
  readonly property string stateDir: (Quickshell.env("XDG_STATE_HOME") || home + "/.local/state") + "/omarchy-buddy"
  // The scripts of this checkout (or this installed plugin), not whatever
  // ~/.local/bin points to.
  readonly property string repo: decodeURIComponent(String(Qt.resolvedUrl("..")).replace(/^file:\/\//, "")).replace(/\/$/, "")
  readonly property string hook: repo + "/bin/omarchy-buddy-hook"
  readonly property string feeder: repo + "/bin/omarchy-buddy-feed"
  // The state folders exist: only then do the parts read their files.
  property bool ready: false
  readonly property string omarchyBin: (Quickshell.env("OMARCHY_PATH") || "/usr/share/omarchy") + "/bin/"

  // Omarchy's shell facade (set by the shell): which edge the bar is on and
  // how thick it is (0 while hidden); tests/looks sets them by hand.
  property var shell: null
  readonly property var barState: shell && shell.bar ? shell.bar : null
  property string barEdge: barState ? String(barState.position || "top") : "top"
  property int barSize: barState ? (barState.barHidden ? 0 : barState.barSize) : Style.bar.sizeHorizontal
  // The bar widgets (one per monitor's bar, BarWidget.qml registers itself);
  // the island docks at the one on its screen.
  property var barWidgets: []
  readonly property var dockWidget: {
    for (var i = 0; i < barWidgets.length; i++) if (barWidgets[i].screenName === screenName) return barWidgets[i]
    return null
  }
  function addBarWidget(w) { if (barWidgets.indexOf(w) === -1) barWidgets = barWidgets.concat([w]) }
  function removeBarWidget(w) { barWidgets = barWidgets.filter(function(x) { return x !== w }) }

  readonly property Prefs prefs: Prefs { app: buddy }
  readonly property Settings settings: Settings { app: buddy }
  readonly property Sessions sessions: Sessions { app: buddy }
  readonly property News news: News { app: buddy }
  readonly property Notifications notifications: Notifications { app: buddy }
  readonly property Toasts toasts: Toasts { app: buddy }
  readonly property Player player: Player { app: buddy; shown: buddy.mode === "open" }
  readonly property Spotify spotify: Spotify { app: buddy }
  readonly property Weather weather: Weather { app: buddy }

  property real now: Date.now() / 1000
  property real lastActivity: Date.now() / 1000
  property bool opened: false
  // Opened by Omarchy's notifications.keyboard: the island takes the keys at
  // once instead of after a click, until it closes.
  property bool keysAsked: false
  property bool peeking: false
  property bool hovered: false
  property string emote: ""
  property bool settingsShown: false  // the settings page instead of the lists
  property bool testDriving: false  // the test IPC is clicking (Probe.qml): take no keys from the user
  property int screencasts: 0      // captures running, as Hyprland reports them
  property bool sharing: false     // ... for longer than a screenshot takes
  // While sharing, as the user set it: quiet (only Claude, critical ones and
  // Omarchy's feedback pop up) or hidden (no island at all; Claude's
  // requests go to the terminal after their countdown).
  readonly property bool silent: prefs.quiet || (sharing && SettingsLogic.quietWhenSharing(settings.values))
  readonly property bool veiled: sharing && SettingsLogic.hideWhenSharing(settings.values)
  onVeiledChanged: if (veiled) opened = false

  // The user away (no input for 2 min, video inhibitors respected) or the island
  // hidden (behind a fullscreen window, while sharing): no animation, pop-ups wait.
  readonly property bool away: idle.isIdle
  // The user touched mouse or keyboard in the last two seconds.
  readonly property bool active: !presence.isIdle
  // (the workspace on the island's monitor, not one on another screen)
  readonly property var monitor: screen ? Hyprland.monitorFor(screen) : null
  readonly property bool fullscreen: monitor && monitor.activeWorkspace ? monitor.activeWorkspace.hasFullscreen : false
  readonly property bool paused: away || fullscreen || veiled

  readonly property var unread: IslandLogic.unread(news.items, notifications.notes, prefs.lastRead, prefs.readIds)
  readonly property bool unreadProblem: IslandLogic.hasProblem(unread)
  readonly property int hour: new Date(now * 1000).getHours()
  // The texts' language (Strings.js): config.json, otherwise Omarchy's
  // choice, otherwise the system's.
  readonly property string lang: Strings.pickLanguage(settings.values.language,
    [Quickshell.env("LC_ALL"), Quickshell.env("LC_MESSAGES"), Quickshell.env("LANG")], omarchyLanguage.text())
  FileView {
    id: omarchyLanguage
    // OMARCHY_LANGUAGE_FILE as with Omarchy's own I18n (tests pin a language).
    path: Quickshell.env("OMARCHY_LANGUAGE_FILE") || (Quickshell.env("XDG_CONFIG_HOME") || buddy.home + "/.config") + "/omarchy/language"
    watchChanges: true
    printErrors: false
    blockLoading: true
    onFileChanged: reload()
  }
  Binding { target: Theme; property: "lang"; value: buddy.lang }
  // The first name for the greeting (IslandLogic.firstName).
  property string userName: ""
  property bool nameKnown: false  // the greeting waits for the name (#192)
  readonly property string greeting: IslandLogic.greeting(hour, userName, lang)
  readonly property string summary: IslandLogic.summary({ needs: sessions.needsCount, working: sessions.workingCount,
                                                          workingName: sessions.workingName, shown: sessions.shownCount, background: sessions.backgroundCount }, unread, lang)

  readonly property string mode: IslandLogic.mode(opened, sessions.currentAsk, toasts.toast, peeking, sessions.answerable)
  readonly property string mood: IslandLogic.mood({ needs: sessions.needsCount, working: sessions.workingCount,
                                                    unreadProblem: unreadProblem, away: away, mode: mode,
                                                    quietFor: now - lastActivity, night: IslandLogic.night(hour) })

  // The screen the island sits on: the focused monitor, unless config.json
  // names one; it stays put while the island shows something.
  property string screenName: ""
  readonly property var screenNames: {
    var names = []
    for (var i = 0; i < Quickshell.screens.length; i++) names.push(String(Quickshell.screens[i].name))
    return names
  }
  readonly property string wantScreen: IslandLogic.pickScreen(screenNames,
    Hyprland.focusedMonitor ? String(Hyprland.focusedMonitor.name) : "",
    settings.values.screen, screenName, mode !== "pill")
  // Later, not inside the binding: wantScreen reads screenName itself.
  onWantScreenChanged: Qt.callLater(function() { buddy.screenName = buddy.wantScreen })
  // Held, not a binding (#229): when its monitor goes, null for a turn, so
  // the island unmaps and maps anew on the screen then chosen, like Omarchy's
  // OverlayWindow. Hyprland closes a layer surface with its output, and
  // Quickshell never maps a closed one again by itself.
  property var screen: null
  function placeScreen() { screen = IslandLogic.screenFor(Quickshell.screens, screenName) }
  onScreenNameChanged: placeScreen()
  Connections {
    target: Quickshell
    function onScreensChanged() {
      if (!IslandLogic.screenGone(Quickshell.screens, buddy.screen)) return
      buddy.screen = null
      Qt.callLater(buddy.placeScreen)
    }
  }
  Binding { target: Theme; property: "screen"; value: buddy.screen }
  Binding { target: Theme; property: "tall"; value: buddy.weather.on }

  function touch() { lastActivity = Date.now() / 1000 }

  function playEmote(name, ms) {
    emote = name
    emoteTimer.interval = ms
    emoteTimer.restart()
  }

  // O-Morchy's emotion (#177) for what pops up, once as it appears:
  // the pop-up on screen (ToastLogic.emoteFor) and a new request. Nothing
  // pops up in the Ruhemodus, fullscreen or while sharing, so nothing plays.
  // Also its song for a new track (#185, Player.qml).
  function feel(name) {
    if (!name || !ToastLogic.emoteWins(name, emote)) return
    emote = ""  // the same one again starts anew
    playEmote(name, 3000)
  }
  readonly property var shownToast: mode === "toast" && !paused ? toasts.toast : null
  onShownToastChanged: {
    var e = ToastLogic.emoteFor(shownToast)
    if (e) feel(e)
    else if (ToastLogic.popupOnly(emote)) emote = ""  // the letter or bubble leaves with its pop-up
  }
  readonly property var shownAsks: mode === "needs" && !paused ? sessions.asks.map(function(a) { return a.key }) : []
  property var greetedAsks: []
  onShownAsksChanged: {
    if (!shownAsks.length) return  // hidden for a while: what was greeted stays greeted
    if (ToastLogic.newAsk(shownAsks, greetedAsks)) feel("ask")
    greetedAsks = shownAsks
  }

  function when(t) { return IslandLogic.when(t, now, lang) }

  function bare(address) { return String(address || "").replace(/^0x/, "") }

  function windowFocused(address) {
    var active = Hyprland.activeToplevel
    return address !== "" && active && bare(active.address) === bare(address)
  }

  function focusAddress(address) {
    var a = IslandLogic.windowAddress(address)
    if (!a) return
    Quickshell.execDetached(["hyprctl", "dispatch", "hl.dsp.focus({ window = \"address:" + a + "\" })"])
  }

  // Sessions in an Orca terminal share Orca's window; the hook asks Orca to
  // show their pane (or just to come up when the pane is gone).
  function focusTarget(item) {
    if (item.orca) Quickshell.execDetached([hook, "--orca-goto", item.orca_terminal || "", item.orca_pane || ""])
    if (item.window) focusAddress(item.window)
  }

  function activate(item) {
    markDone(item)
    if (item.url) Quickshell.execDetached(["xdg-open", item.url])
    else focusTarget(item)
  }

  // A news item's button (IslandLogic.actionLabel).
  function runAction(item) {
    markDone(item)
    var command = IslandLogic.actionCommand(item.action, repo, lang)
    if (command) Quickshell.execDetached(command)
  }

  function markRead() {
    if (!news.items.length && !notifications.notes.length) return
    prefs.lastRead = IslandLogic.readUpTo(prefs.lastRead, news.items, notifications.notes)
    prefs.readIds = IslandLogic.addRead(prefs.readIds, {}, prefs.lastRead)
    prefs.save()
  }

  // Clicked (opened, a button, a reply) or taken out with ×: no longer
  // "Für dich" (#178). Older than the block keeps is dropped from ui.json.
  function markDone(item) {
    var ids = IslandLogic.doneBy(item, notifications.notes)
    if (!Object.keys(ids).length) return
    prefs.doneIds = IslandLogic.addRead(prefs.doneIds, ids, Math.max(prefs.doneUpTo, IslandLogic.forYouSince(now)))
    prefs.save()
  }

  // A pop-up the user had on screen is read.
  function markToastRead(t) {
    var ids = IslandLogic.readBy(t, notifications.notes)
    if (!Object.keys(ids).length) return
    prefs.readIds = IslandLogic.addRead(prefs.readIds, ids, prefs.lastRead)
    prefs.save()
  }

  function hoverChanged(on) {
    hovered = on
    if (on) { touch(); peekOut.stop(); peekIn.restart() }
    else { peekIn.stop(); peekOut.restart() }
  }

  // Click on the island itself. The third of three quick clicks also makes
  // O-Morchy dizzy (the first one has already acted). A right click puts a
  // pop-up away (as its "×"), closes the open view or goes to the terminal
  // that asks.
  property int clicks: 0
  function countClick() {
    touch()
    clicks++
    clickReset.restart()
    if (clicks < 3) return false
    clicks = 0
    playEmote("dizzy", 3000)
    return true
  }

  function islandClicked(button) {
    if (!countClick()) runClick(IslandLogic.clickAction(button === Qt.RightButton, mode, toasts.toast))
  }
  function widgetClicked(button) {
    if (!countClick()) runClick(IslandLogic.widgetClickAction(button === Qt.RightButton, mode, toasts.toast))
  }
  function runClick(action) {
    var t = toasts.toast
    switch (action) {
      case "close": opened = false; break
      case "dismiss": toasts.dismissToast(); break
      case "goToAsk": if (sessions.currentAsk) sessions.focusSession(sessions.currentAsk.session); break
      case "activateNote": notifications.activateNote(t); break
      case "activate": toasts.next(); activate(t); break
      case "openFromToast": toasts.next(); opened = true; break
      case "open": playEmote("squish", 260); opened = true; break
    }
  }

  // Closing the open view marks everything in it as read. (Toasts.qml
  // holds pop-ups back while it is open and shows them afterwards.)
  onOpenedChanged: {
    if (opened) return
    settingsShown = false
    markRead()
    notifications.replyKey = ""
    news.unfolded = ({})
    keysAsked = false
    Theme.lostKey = ""
  }

  // A command that gets the user's words on stdin, never as an argument:
  // other users can read /proc/*/cmdline (#219). Gone once it has run.
  function runWithInput(argv, text) {
    withInput.createObject(buddy, { command: argv, payload: String(text) }).running = true
  }
  Component {
    id: withInput
    Process {
      property string payload
      stdinEnabled: true
      onStarted: { write(payload); stdinEnabled = false }
      onExited: destroy()
    }
  }

  // The state folder holds private messages: the user's alone, old files
  // and subfolders included (nobody else may read anything in it). The files
  // the shell writes are made first, because a file FileView creates is
  // 644 (an existing one keeps its rights).
  Process {
    running: true
    command: ["sh", "-c",
      "umask 077; mkdir -p \"$2\"; mkdir -p \"$1\" && chmod -R go= \"$1\" && cd \"$1\" || exit 0; " +
      "for f in notifications.json ui.json news.json popups.json; do [ -e \"$f\" ] || : > \"$f\"; done", "sh", buddy.stateDir, buddy.runDir]
    onExited: buddy.ready = true
  }
  Process {
    running: true
    command: ["sh", "-c", "getent passwd \"$(id -un)\""]
    stdout: StdioCollector { onStreamFinished: { buddy.userName = IslandLogic.firstName(text); buddy.nameKnown = true } }
  }

  // The first minutes (#192): without setup.json (the plugin switched on,
  // the setup never ran) a pop-up offers the setup; after a first setup
  // O-Morchy greets once (ToastLogic.firstRun). The file is looked for again
  // while it is missing: a setup that changed nothing restarts no shell.
  property bool setupKnown: false
  property bool setupMissing: false
  property string setupText: ""
  readonly property string firstRun: setupKnown && nameKnown && prefs.loaded && settings.loaded ? ToastLogic.firstRun(setupMissing, setupText, prefs.welcomed) : ""
  onFirstRunChanged: {
    var time = Date.now() / 1000
    if (firstRun === "setup") { toasts.enqueue([ToastLogic.setupToast(time, lang)]); return }
    toasts.withdraw(ToastLogic.setupKey)
    if (firstRun !== "welcome") return
    toasts.enqueue([ToastLogic.welcomeToast(time, lang, userName)])
    var since = ToastLogic.setupSince(setupText)
    Qt.callLater(function() { buddy.prefs.set("welcomed", since) })  // (not inside firstRun's own change)
  }
  FileView {
    id: setupFile
    path: buddy.ready ? buddy.stateDir + "/setup.json" : ""
    watchChanges: true
    printErrors: false
    onLoaded: { buddy.setupText = text(); buddy.setupMissing = false; buddy.setupKnown = true }
    onLoadFailed: { buddy.setupText = ""; buddy.setupMissing = true; buddy.setupKnown = true }
    onFileChanged: reload()
  }
  Timer { interval: 5000; repeat: true; running: buddy.setupMissing; onTriggered: setupFile.reload() }
  // A session came once: the "Agents" section stops explaining (SessionList.qml).
  readonly property bool sessionCame: prefs.loaded && sessions.sessions.length > 0
  onSessionCameChanged: if (sessionCame && !prefs.agentsSeen) prefs.set("agentsSeen", true)

  IdleMonitor {
    id: idle
    timeout: 120
    respectInhibitors: true
  }
  IdleMonitor {
    id: presence
    timeout: 2
    respectInhibitors: false
  }

  // Screen sharing (screencast>>1,owner / 0,owner). A screenshot with grim
  // sends the same event for a moment; only what lasts counts as sharing.
  Connections {
    target: Hyprland
    function onRawEvent(event) {
      if (event.name !== "screencast") return
      var before = buddy.screencasts
      buddy.screencasts = SettingsLogic.screencasts(before, event.data)
      if (buddy.screencasts === 0) { shareDelay.stop(); buddy.sharing = false }
      else if (before === 0) shareDelay.restart()
    }
  }
  Timer {
    id: shareDelay
    interval: SettingsLogic.shareDelay
    onTriggered: buddy.sharing = buddy.screencasts > 0
  }

  // The clock for everything that ages (session states, "seit … min").
  Timer {
    interval: 30000
    running: true
    repeat: true
    onTriggered: buddy.now = Date.now() / 1000
  }
  // Sign of life for omarchy-buddy-hook: it waits for a decision only while
  // this file is younger than 15 s (tmpfs, so writing it costs nothing).
  FileView { id: aliveFile; path: buddy.ready ? buddy.runDir + "/island" : ""; preload: false; printErrors: false }
  Timer {
    interval: 5000
    running: buddy.ready
    repeat: true
    triggeredOnStart: true
    onTriggered: aliveFile.setText(String(Date.now()))
  }
  Timer { id: emoteTimer; onTriggered: buddy.emote = "" }
  Timer { id: clickReset; interval: 450; onTriggered: buddy.clicks = 0 }
  Timer { id: peekIn; interval: 150; onTriggered: buddy.peeking = true }
  Timer { id: peekOut; interval: 400; onTriggered: buddy.peeking = false }

  IpcHandler {
    target: "omarchy-buddy"

    // No island while the screen is shared and it hides: nothing to open.
    function open(): void { buddy.opened = !buddy.veiled }
    function close(): void { buddy.opened = false }
    function toggle(): void { buddy.opened = !buddy.opened && !buddy.veiled }
  }

  Probe { app: buddy; island: islandWindow.islandItem; playerWindow: islandWindow.playerItem }

  Island { id: islandWindow; app: buddy; visible: !buddy.veiled && !!buddy.screen }
}
