import QtQuick
import Quickshell
import qs.Commons
import "theme"
import "components"
import "IslandLogic.js" as IslandLogic
import "WeatherLogic.js" as WeatherLogic

// O-Morchy in Omarchy's bar (#182, the manifest's barWidget; by default beside
// the clock, omarchy-buddy-setup puts it there). At rest only O-Morchy and
// its marks: a request (the asking agent's logo), the newest unread one (a
// chat, mail or event mark, otherwise a dot) and the Ruhemodus bell. While
// something goes on, a short text beside it (IslandLogic.barText; not in a
// left or right bar), otherwise the weather when it rains or a warning is
// in force (#184, with "Omarchy-Wetter ersetzen"). Pointer over it: the peek under the bar; a click opens
// or closes the island there (IslandLogic.widgetClickAction), a right click
// is the island's. In the bar's colours and font, like Omarchy's own widgets.
// The island itself is the service (Buddy.qml); every monitor's bar has a
// widget, the island docks at the one on its screen.
Item {
  id: widget

  // Set by the bar (Omarchy's plugins/bar/README.md); tests/looks sets a stand-in.
  property var bar: null
  property string moduleName: ""
  property var settings: ({})

  // The service through Omarchy's facade (only its own); it may come up
  // after the widget or be made anew, so it is looked up until found.
  property var app: null
  property var registered: null
  function find() {
    if (!app && bar && bar.shell) app = bar.shell.serviceFor(moduleName || "io.github.destrukt1v.omarchy-buddy")
  }
  onBarChanged: find()
  onAppChanged: {
    if (registered && registered !== app) registered.removeBarWidget(widget)
    registered = app
    if (app) { app.addBarWidget(widget); Qt.callLater(measure) }
  }
  Component.onDestruction: if (registered) registered.removeBarWidget(widget)
  Timer { interval: 1000; repeat: true; running: !widget.app && !!widget.bar; onTriggered: widget.find() }

  readonly property bool vertical: bar ? bar.vertical === true : false
  readonly property int barSize: bar && bar.barSize > 0 ? bar.barSize : Style.bar.sizeHorizontal
  readonly property color fg: bar ? bar.barForeground : Theme.fg
  readonly property color alert: bar ? bar.urgent : Theme.urgent
  readonly property string family: bar && bar.fontFamily ? bar.fontFamily : Style.font.family
  // O-Morchy's eyes: the theme's darker or lighter colour, whichever stands
  // out from its body (the bar's text colour, picked for the wallpaper on a
  // transparent bar).
  readonly property color ink: IslandLogic.isLight(fg.r, fg.g, fg.b) === Theme.light ? Theme.fg : Theme.bg

  // Where the widget is on its screen, for the island (IslandLogic.dock);
  // the bar spans its edge, so the bar window's coordinates are the screen's.
  readonly property string screenName: QsWindow.window && QsWindow.window.screen ? String(QsWindow.window.screen.name) : ""
  property var rect: null
  function measure() {
    var p = mapToItem(null, 0, 0)
    var r = { x: Math.round(p.x), y: Math.round(p.y), w: Math.round(width), h: Math.round(height) }
    if (JSON.stringify(r) !== JSON.stringify(rect)) rect = r
  }
  onWidthChanged: Qt.callLater(measure)
  onXChanged: Qt.callLater(measure)
  Connections {
    target: widget.app
    function onModeChanged() { widget.measure() }
  }

  // One Omarchy pop-up at a time: the open view counts as this widget's,
  // so opening the clock's closes it, and opening it closes the clock's.
  // open/close/opened are Omarchy's panel contract (plugins/bar/Bar.qml):
  // `omarchy-shell shell summon/hide io.github.destrukt1v.omarchy-buddy` and Tab from another
  // bar panel land here. Summoned by key, the island takes the keys at once
  // (as notifications.keyboard), so Escape closes it.
  readonly property bool opened: !!app && app.dockWidget === widget && app.opened
  onOpenedChanged: {
    if (!bar) return
    if (opened) bar.requestPopout(widget)
    else bar.releasePopout(widget)
  }
  function open() {
    if (!app || app.veiled) return
    app.keysAsked = true
    app.opened = true
  }
  function close() { if (app) app.opened = false }
  function toggle() { if (app && app.opened) close(); else open() }

  readonly property string text: !app || vertical ? "" : IslandLogic.barText({
    needs: app.sessions.needsCount, needsName: app.sessions.needsName,
    working: app.sessions.workingCount, workingName: app.sessions.workingName }, Theme.lang)

  // The weather only when nothing else is said (WeatherLogic.barText).
  readonly property var weather: app && text === "" ? app.weather.bar : null

  // Room on both sides (#185), so it stands apart from the clock.
  implicitWidth: vertical ? barSize : marks.implicitWidth + 2 * Style.spaceReal(17)
  implicitHeight: vertical ? marks.implicitHeight + 2 * Style.spaceReal(12) : barSize

  Accessible.role: Accessible.Button
  Accessible.name: "Omarchy-Buddy"
  Accessible.description: app ? app.summary + (weather ? ", " + Theme.t("a11y.weather", weather.text) : "") : ""

  Grid {
    id: marks
    anchors.centerIn: parent
    columns: widget.vertical ? 1 : 8
    spacing: Style.space(6)
    horizontalItemAlignment: Grid.AlignHCenter
    verticalItemAlignment: Grid.AlignVCenter

    OMorchy {
      px: IslandLogic.barMorchyPx(widget.barSize)
      body: widget.fg
      ink: widget.ink
      mood: widget.app ? widget.app.mood : "sleep"
      emote: widget.app ? widget.app.emote : ""
      paused: widget.app ? widget.app.paused : true
    }
    // "braucht dich": the asking agent's logo (Nerd Font, Codicons), so it
    // differs from the news dot in form, not only in colour.
    Text {
      visible: !!widget.app && widget.app.sessions.needsCount > 0
      text: widget.app ? widget.app.sessions.needsMark : ""
      color: widget.alert
      font.family: widget.family
      font.pixelSize: Style.bar.iconFont
      Accessible.role: Accessible.StaticText
      Accessible.name: widget.app ? Theme.t("a11y.needs", widget.app.sessions.needsName) : ""
    }
    Text {
      visible: widget.text !== ""
      width: Math.min(implicitWidth, Style.font.body * 22)
      text: widget.text
      elide: Text.ElideRight
      // In the bar's colour, readable over any wallpaper (#192, B3): the
      // agent's logo before it carries the red, the weight the urgency.
      color: widget.fg
      font.family: widget.family
      font.pixelSize: Style.font.body
      font.weight: widget.app && widget.app.sessions.needsCount > 0 ? Font.DemiBold : Font.Normal
      textFormat: Text.PlainText
    }
    Text {
      visible: !!widget.weather
      text: widget.weather ? WeatherLogic.glyph(widget.weather.icon) : ""
      color: widget.weather && widget.weather.alert ? widget.alert : widget.fg
      font.family: widget.family
      font.pixelSize: Style.bar.iconFont
      Accessible.role: Accessible.StaticText
      Accessible.name: widget.weather ? Theme.t("a11y.weather", widget.weather.text) : ""
    }
    Text {
      visible: !!widget.weather && !widget.vertical
      width: Math.min(implicitWidth, Style.font.body * 16)
      text: widget.weather ? widget.weather.text : ""
      elide: Text.ElideRight
      // Like "… braucht dich" (#192): the bar's colour over any wallpaper, the icon carries the red.
      color: widget.fg
      font.family: widget.family
      font.pixelSize: Style.font.body
      font.weight: widget.weather && widget.weather.alert ? Font.DemiBold : Font.Normal
      textFormat: Text.PlainText
      Accessible.ignored: true
    }
    // After the text (#193, B11), so it does not read as the agent's state.
    // A message from a person: its mark instead of the dot (IslandLogic.pillMark).
    KindMark {
      id: kindMark
      kind: widget.app && widget.app.unread.length > 0 && widget.app.sessions.needsCount === 0 ? IslandLogic.pillMark(widget.app.unread) : ""
      size: Style.bar.iconFont
      color: "transparent"
      ink: widget.fg
      name: kind ? Theme.t("a11y.new." + kind) : ""
    }
    // A live state, not decoration: something unread (red-ish: a problem).
    Rectangle {
      visible: !!widget.app && widget.app.unread.length > 0 && widget.app.sessions.needsCount === 0 && kindMark.kind === ""
      width: Style.space(6); height: width; radius: width / 2
      color: widget.app && widget.app.unreadProblem ? widget.alert : widget.fg
      Accessible.role: Accessible.StaticText
      Accessible.name: Theme.t("a11y.unread")
    }
    Text {
      visible: !!widget.app && widget.app.silent
      text: "󰂛"
      color: widget.fg
      font.family: widget.family
      font.pixelSize: Style.bar.iconFont
    }
  }

  MouseArea {
    anchors.fill: parent
    hoverEnabled: true
    acceptedButtons: Qt.LeftButton | Qt.RightButton
    cursorShape: Qt.PointingHandCursor
    onContainsMouseChanged: {
      if (!widget.app) return
      if (containsMouse) widget.measure()
      widget.app.hoverChanged(containsMouse)
    }
    onClicked: function(m) {
      if (!widget.app) return
      widget.measure()
      widget.app.widgetClicked(m.button)
    }
  }
}
