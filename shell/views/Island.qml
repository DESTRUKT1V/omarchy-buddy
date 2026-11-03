import QtQuick
import Quickshell
import Quickshell.Hyprland
import Quickshell.Wayland
import qs.Commons
import qs.Ui
import "../theme"
import "../IslandLogic.js" as IslandLogic
import "../WeatherLogic.js" as WeatherLogic

// The layer surface at the bar and the island in it (#182): an Omarchy
// pop-up in the middle under the bar (beside the widget on a left or right bar, above it on
// a bottom one), in Omarchy's pop-up colours, edge and corner radius. At rest
// (pill) the widget in the bar is all there is: the island is hidden and takes
// no input. The island takes the size of the view it shows; size changes run
// 480 ms and settle without overshoot (F29; with "Weniger Bewegung" the size
// jumps), it fades in and out like an Omarchy pop-up, views fade out quickly
// and come in shortly after, from 97 % scale (not with "Weniger Bewegung").
// All of it is time-based.
PanelWindow {
  id: panel
  required property var app
  readonly property Item islandItem: island  // for the test IPC (Probe.qml)
  readonly property Item playerItem: playerWindow

  screen: Theme.screen
  // At the bar's edge and moved along it by margins (IslandLogic.dock), so
  // the surface stays small instead of spanning the whole 3440 px.
  readonly property string edge: app.barEdge
  readonly property int gap: Style.gapsOut
  readonly property var dock: IslandLogic.dock({ edge: edge, bar: app.barSize, gap: gap,
    screenW: screen ? screen.width : 0, screenH: screen ? screen.height : 0, surfaceW: implicitWidth, fullH: fullHeight,
    widget: app.dockWidget ? app.dockWidget.rect : null })
  anchors.top: edge !== "bottom"
  anchors.bottom: edge === "bottom"
  anchors.left: edge !== "right"
  anchors.right: edge === "right"
  margins.left: dock.left
  margins.top: dock.top
  // Room on both sides for the player window.
  implicitWidth: Theme.openWidth + Theme.pad * 2 + Theme.s(160) + 2 * (Theme.s(10) + Theme.s(264) + Theme.pad * 2)
  // Only as tall as the view needs (#156: Qt redraws the whole surface on
  // every frame the island moves); it grows at once and shrinks only after
  // the island's resize has settled (IslandLogic.surfaceHeight).
  readonly property int fullHeight: Math.min(app.barSize + gap + Theme.listMaxHeight + Theme.s(220), screen ? screen.height : 100000)
  readonly property real neededHeight: dock.inset + Math.max(island.targetHeight, playerWindow.visible ? playerWindow.height : 0, weatherWindow.visible ? weatherReach : 0) + 1
  property int surfaceHeight: fullHeight
  implicitHeight: surfaceHeight
  onNeededHeightChanged: { surfaceHeight = IslandLogic.surfaceHeight(surfaceHeight, neededHeight, fullHeight, false); settle.restart() }
  onFullHeightChanged: settle.restart()
  Component.onCompleted: settle.restart()
  Timer { id: settle; interval: island.resizeMs + 100; onTriggered: panel.surfaceHeight = IslandLogic.surfaceHeight(panel.surfaceHeight, panel.neededHeight, panel.fullHeight, true) }
  color: "transparent"
  exclusionMode: ExclusionMode.Ignore
  WlrLayershell.namespace: "omarchy-buddy"
  // tests/looks: above the running island and its pop-ups.
  WlrLayershell.layer: Quickshell.env("OMARCHY_BUDDY_LOOKS") ? WlrLayer.Overlay : WlrLayer.Top
  // Keys only after the user clicked into the island (F9): the open view
  // (Tab, Enter, Space, Escape), a reply, an answer or plan feedback for
  // Claude. A request or a pop-up never takes them by itself; Omarchy's
  // keyboard key (notifications.keyboard) hands them over at once.
  readonly property bool typing: app.notifications.replyKey !== "" || app.sessions.typingKey !== ""
  readonly property bool takesKeys: (app.opened || typing) && !app.testDriving
  readonly property bool exclusive: takesKeys && app.keysAsked
  WlrLayershell.keyboardFocus: exclusive ? WlrKeyboardFocus.Exclusive
    : takesKeys ? WlrKeyboardFocus.OnDemand : WlrKeyboardFocus.None
  // Hyprland drops every focus grab when a layer turns Exclusive
  // (LayerSurface.cpp, #179): a clear right after that is taken back, it is
  // not a click elsewhere.
  onExclusiveChanged: if (exclusive) exclusiveSettle.restart()
  Timer { id: exclusiveSettle; interval: 500 }
  property bool regrab: false

  // Only the island (not at rest), the player and the weather take input; clicks
  // elsewhere reach the windows below.
  mask: Region { item: island.shown ? island : null; Region { item: playerWindow.visible ? playerWindow : null } Region { item: weatherWindow.visible ? weatherWindow : null } }

  // The bar with the widget belongs to it: a click on the widget closes the
  // open view itself (BarWidget.qml), it is not a click elsewhere. Not while
  // Exclusive: with the bar in the grab the island gets no keys (#207); then
  // a clear with the pointer on the widget is left to its click.
  readonly property var barWindow: app.dockWidget ? app.dockWidget.QsWindow.window : null
  HyprlandFocusGrab {
    windows: panel.barWindow && !panel.exclusive ? [panel, panel.barWindow] : [panel]
    active: panel.takesKeys && !panel.regrab
    onCleared: {
      if (exclusiveSettle.running) {
        exclusiveSettle.stop()
        // Later: Quickshell sets the grab inactive only after this signal.
        Qt.callLater(function() { panel.regrab = true; panel.regrab = false })
        return
      }
      if (panel.exclusive && panel.app.hovered) return
      panel.app.opened = false; panel.app.notifications.replyKey = ""; panel.app.sessions.typingKey = ""
    }
  }

  BorderSurface {
    id: island
    readonly property string mode: panel.app.mode
    // At rest the peek waits hidden, so the island only fades in on hover.
    readonly property Item content: mode === "open" ? openView
      : mode === "needs" ? needsView
      : mode === "toast" ? toastView
      : peekView
    readonly property bool shown: mode !== "pill"
    readonly property bool alarm: mode === "needs" || (mode === "toast" && panel.app.toasts.toast && panel.app.toasts.toast.level === "error")

    x: IslandLogic.islandX(panel.edge, panel.dock.centre, panel.app.barSize, panel.gap, panel.width, width)
    y: panel.edge === "bottom" ? panel.height - panel.dock.inset - height : panel.dock.inset
    width: Math.ceil(content.implicitWidth) + Theme.pad * 2
    readonly property int targetHeight: Math.ceil(content.implicitHeight) + Theme.pad * 2
    height: targetHeight
    radius: Style.cornerRadius
    color: Theme.bg
    borderSpec: Theme.edge(alarm)
    visible: opacity > 0
    opacity: shown ? 1 : 0
    Behavior on opacity { NumberAnimation { duration: island.shown ? 200 : 140; easing.type: Easing.OutCubic } }
    clip: true
    // Escape from wherever the focus is inside (a field handles its own).
    focus: true
    Keys.onEscapePressed: { panel.app.opened = false; panel.app.notifications.replyKey = ""; panel.app.sessions.typingKey = "" }
    // A new view starts with the focus on the island, not on a hidden button.
    onModeChanged: forceActiveFocus()

    // Hidden, the island takes its new size at once; shown, it grows into it.
    readonly property int resizeMs: Theme.reduceMotion ? 0 : 480
    Behavior on width { enabled: island.opacity > 0; NumberAnimation { duration: island.resizeMs; easing.type: Easing.BezierSpline; easing.bezierCurve: [0.25, 1, 0.5, 1, 1, 1] } }
    Behavior on height { enabled: island.opacity > 0; NumberAnimation { duration: island.resizeMs; easing.type: Easing.BezierSpline; easing.bezierCurve: [0.25, 1, 0.5, 1, 1, 1] } }

    HoverHandler {
      id: islandHover
      onHoveredChanged: if (island.shown || !hovered) panel.app.hoverChanged(hovered)
    }

    MouseArea {
      anchors.fill: parent
      acceptedButtons: Qt.LeftButton | Qt.RightButton
      cursorShape: island.mode === "open" ? Qt.ArrowCursor : Qt.PointingHandCursor
      onClicked: function(m) { panel.app.islandClicked(m.button) }
    }

    PeekView { id: peekView; app: panel.app; shown: island.mode === "peek"; anchors.centerIn: parent }
    ToastView { id: toastView; app: panel.app; shown: island.mode === "toast"; anchors.left: parent.left; anchors.top: parent.top; anchors.margins: Theme.pad }
    NeedsView { id: needsView; app: panel.app; maxHeight: panel.fullHeight - panel.dock.inset - panel.gap - Theme.pad * 2; shown: island.mode === "needs"; anchors.left: parent.left; anchors.top: parent.top; anchors.margins: Theme.pad }
    OpenView { id: openView; app: panel.app; shown: island.mode === "open"; anchors.left: parent.left; anchors.top: parent.top; anchors.margins: Theme.pad }

    // Something new under the pointer: clicks wait a moment (the second
    // click of a double click must not answer Claude or open a message).
    readonly property string clickTarget: IslandLogic.clickTarget(mode,
      panel.app.toasts.toast ? String(panel.app.toasts.toast.key || panel.app.toasts.toast.time) : "",
      panel.app.sessions.currentAsk ? panel.app.sessions.currentAsk.key : "")
    onClickTargetChanged: if (clickTarget !== "") clickGuard.restart()
    Timer { id: clickGuard; interval: IslandLogic.clickGuardMs }
    MouseArea {
      anchors.fill: parent
      enabled: clickGuard.running
      acceptedButtons: Qt.AllButtons
      onClicked: panel.app.countClick()
    }
  }

  // The music player beside the open view, top-aligned with it (on a
  // bottom bar bottom-aligned), and the weather (#184) as a tile of its own
  // further from the bar, the same gap apart (#189); without music the
  // weather takes the player's place. Both ride on the island's
  // (time-based) width, so they follow while it grows; the weather reaches
  // to the island's far edge and follows its (time-based) height (#190).
  // (on a right bar on the island's left, away from the bar)
  readonly property int sideGap: Theme.s(10)
  readonly property real sideX: edge === "right" ? island.x - sideGap - Theme.s(264) - Theme.pad * 2 : island.x + island.width + sideGap
  readonly property real weatherReach: (playerWindow.music ? playerWindow.height + sideGap : 0) + weatherWindow.height

  SideWindow {
    id: playerWindow
    readonly property bool music: !!panel.app.player.current
    shown: panel.app.mode === "open" && music
    y: panel.edge === "bottom" ? island.y + island.height - height : island.y
    height: Math.ceil(playerView.implicitHeight) + Theme.pad * 2
    Accessible.name: music ? Theme.t("player.window", panel.app.player.current.identity) : ""

    PlayerView { id: playerView; x: Theme.pad; y: Theme.pad; visible: playerWindow.music; app: panel.app; player: panel.app.player.current }
  }

  SideWindow {
    id: weatherWindow
    shown: panel.app.mode === "open" && panel.app.weather.on
    y: panel.edge === "bottom" ? island.y + island.height - panel.weatherReach : island.y + panel.weatherReach - height
    // Not on a bottom bar: there the top follows the island's resize at once,
    // a chase would push the tile into the player (#190).
    Behavior on y { enabled: weatherWindow.opacity > 0 && !Theme.reduceMotion && panel.edge !== "bottom"; NumberAnimation { duration: 300; easing.type: Easing.OutCubic } }
    readonly property var fit: WeatherLogic.tile(Math.ceil(weatherView.implicitHeight) + Theme.pad * 2, island.height,
      playerWindow.music ? playerWindow.height + panel.sideGap : 0, weatherView.hasBars, Theme.s(24), weatherView.hoursNeed)
    height: fit.height
    Accessible.name: Theme.t("weather.window", panel.app.weather.place ? panel.app.weather.place.name : "")

    WeatherView { id: weatherView; x: Theme.pad; y: Theme.pad; app: panel.app; grow: weatherWindow.fit.bars; drop: weatherWindow.fit.alerts; showHours: weatherWindow.fit.hours }
  }

  // The player and the weather beside the open view (on a right bar on its
  // left): they fade in a moment after it and slide in from the island's side.
  component SideWindow: BorderSurface {
    id: side
    property bool shown: false
    x: panel.sideX
    width: Theme.s(264) + Theme.pad * 2
    radius: Style.cornerRadius
    color: Theme.bg
    borderSpec: Theme.edge(false)
    visible: opacity > 0
    opacity: shown ? 1 : 0
    Behavior on opacity { SequentialAnimation { PauseAnimation { duration: side.shown ? 160 : 0 } NumberAnimation { duration: side.shown ? 300 : 160; easing.type: Easing.OutCubic } } }
    transform: Translate {
      x: side.shown || Theme.reduceMotion ? 0 : panel.edge === "right" ? Theme.s(12) : -Theme.s(12)
      Behavior on x { NumberAnimation { duration: 300; easing.type: Easing.OutCubic } }
    }
    Accessible.role: Accessible.Pane
    Keys.onEscapePressed: panel.app.opened = false
    // A click on the window's background does nothing (it is not "elsewhere").
    MouseArea { anchors.fill: parent }
  }
}
