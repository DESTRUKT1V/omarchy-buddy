import QtQuick
import Quickshell
import Quickshell.Hyprland
import Quickshell.Io
import Quickshell.Wayland
import qs.Commons
import qs.Commons as Commons
import "buddy"
import "buddy/theme"
import "buddy/IslandLogic.js" as IslandLogic

// tests/looks (#181, #182): this checkout's island and bar widget over a
// stand-in for the desk (the wallpaper and a mock of Omarchy's bar with the
// clock and the real BarWidget.qml beside it), so its screenshots show
// neither the running island nor windows (both on the overlay layer, above
// them). Run by tests/looks in a temporary Quickshell folder ("buddy" links
// to shell/, "Commons" and "Ui" to Omarchy's).
ShellRoot {
  id: root
  property bool fullBar: false
  property string edge: "top"
  property bool started: false
  readonly property bool vertical: edge === "left" || edge === "right"
  readonly property int barSize: vertical ? Style.bar.sizeVertical : Style.bar.sizeHorizontal
  // A transparent bar keeps the text Omarchy picked for the wallpaper; a full one takes the theme's.
  readonly property color barText: Theme.testColors && fullBar ? Theme.testColors.foreground : Commons.Color.bar.text
  readonly property color barBg: Theme.testColors ? Theme.testColors.background : Commons.Color.bar.background

  IpcHandler {
    target: "omarchy-buddy.looks"
    function bar(full: bool): void { root.fullBar = full }
    function edge(name: string): void { root.edge = name }
    function radius(n: int): void { Style.cornerRadius = n }
    // The screen, the widget's rect on it and the island surface's margins: "sx sy sw sh wx wy ww wh left top".
    function geometry(): string {
      var s = desk.screen, r = widget.rect || { x: 0, y: 0, w: 0, h: 0 }
      var surfaceW = Theme.openWidth + Theme.pad * 2 + Theme.s(160) + 2 * (Theme.s(10) + Theme.s(264) + Theme.pad * 2)
      var d = IslandLogic.dock({ edge: root.edge, bar: root.barSize, gap: Style.gapsOut, screenW: s.width, screenH: s.height,
        surfaceW: surfaceW, fullH: Math.min(root.barSize + Style.gapsOut + Theme.listMaxHeight + Theme.s(220), s.height), widget: widget.rect })
      return [s.x, s.y, s.width, s.height, r.x, r.y, r.w, r.h, d.left, d.top].map(Math.round).join(" ")
    }
  }

  // What the bar hands its widgets (Omarchy's PluginBarApi), as far as BarWidget.qml reads it.
  QtObject {
    id: barApi
    readonly property color barForeground: root.barText
    readonly property color urgent: Theme.testColors ? Theme.testColors.urgent : Commons.Color.bar.active
    readonly property string fontFamily: Style.font.family
    readonly property string position: root.edge
    readonly property bool vertical: root.vertical
    readonly property int barSize: root.barSize
    property var shell: null
    function requestPopout(owner) {}
    function releasePopout(owner) {}
  }

  PanelWindow {
    id: desk
    screen: {
      var f = Hyprland.focusedMonitor ? String(Hyprland.focusedMonitor.name) : ""
      for (var i = 0; i < Quickshell.screens.length; i++) if (Quickshell.screens[i].name === f) return Quickshell.screens[i]
      return Quickshell.screens[0]
    }
    // Only the strip along the bar the island needs, not the whole screen.
    anchors { top: root.edge !== "bottom"; bottom: root.edge !== "top"; left: root.edge !== "right"; right: root.edge !== "left" }
    implicitWidth: root.vertical ? Theme.s(1400) : 0
    implicitHeight: root.vertical ? 0 : Math.min(root.barSize + Theme.listMaxHeight + Theme.s(260), screen ? screen.height : 1000)
    exclusionMode: ExclusionMode.Ignore
    WlrLayershell.layer: WlrLayer.Overlay
    WlrLayershell.keyboardFocus: WlrKeyboardFocus.None
    WlrLayershell.namespace: "omarchy-buddy-looks"
    color: "transparent"
    mask: Region {}

    // The wallpaper where it really is.
    Image {
      y: root.edge === "bottom" ? desk.height - height : 0
      width: desk.screen.width
      height: desk.screen.height
      source: "file://" + Quickshell.env("LOOKS_WALLPAPER")
      fillMode: Image.PreserveAspectCrop
      onStatusChanged: if (status === Image.Ready) root.started = true
    }

    Rectangle {
      id: barRect
      x: root.edge === "right" ? parent.width - width : 0
      y: root.edge === "bottom" ? parent.height - height : 0
      width: root.vertical ? root.barSize : parent.width
      height: root.vertical ? parent.height : root.barSize
      color: root.fullBar ? root.barBg : "transparent"

      Text {
        id: clock
        anchors.centerIn: parent
        text: root.vertical ? Qt.formatDateTime(new Date(), "HH\n—\nmm") : Qt.formatDateTime(new Date(), "ddd d MMM HH:mm")
        horizontalAlignment: Text.AlignHCenter
        color: root.barText
        font.family: Style.font.family
        font.pixelSize: Style.font.body
      }
      BarWidget {
        id: widget
        bar: barApi
        app: loader.item
        x: root.vertical ? (parent.width - width) / 2 : clock.x + clock.width + Style.space(8)
        y: root.vertical ? clock.y + clock.height + Style.space(8) : (parent.height - height) / 2
        width: implicitWidth
        height: implicitHeight
        onXChanged: measure()
        onYChanged: measure()
      }
    }
  }

  // The island only after the desk is up: of two layers on the same level,
  // the later one lies on top.
  LazyLoader {
    id: loader
    active: root.started
    Buddy { barEdge: root.edge; barSize: root.barSize }
  }
}
