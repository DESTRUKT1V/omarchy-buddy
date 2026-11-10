import QtQuick
import qs.Commons
import "../theme"
import "../components"
import "../WeatherLogic.js" as WeatherLogic

// The weather tile (#184) beside the open view, a window of its own under
// the music player (#189; in its place without music): the place (a click searches
// another, as in Omarchy's widget) and from when, now with felt and today,
// rain in the next two hours as bars, the DWD's warnings.
// While it loads, fails or knows no place it says so. Weather.qml holds the
// weather; this file only shows. Taller than its content (#190), the bars
// grow by `grow` and the warnings move down by `drop` (WeatherLogic.tile);
// both only shift what is drawn, the layout (implicitHeight) stays the content's.
// The hours ahead (#191) hang under the bars the same way: shown when the
// tile has room for `hoursNeed` (showHours), never part of the layout.
Column {
  id: view
  required property var app
  readonly property var weather: app.weather
  readonly property var report: weather.report
  readonly property string state: weather.state
  readonly property real now: app.now
  property bool picking: false
  property real grow: 0
  property real drop: 0
  property bool showHours: false
  readonly property bool hasBars: rain.visible
  readonly property var hours: report ? WeatherLogic.nextHours(report.hours, now) : []
  // What the hours need under the bars: their gap and their own height
  // (which does not depend on whether they show).
  readonly property real hoursNeed: hasBars && hours.length ? Theme.s(16) + hourRow.implicitHeight : 0
  width: Theme.s(264)
  spacing: Theme.s(12)
  // Closed: the search is over.
  readonly property bool opened: app.opened
  onOpenedChanged: if (!opened) { picking = false; weather.endSearch() }

  // The place and from when; the place is the way to change it.
  Item {
    visible: !view.picking && view.state !== "noPlace"
    width: parent.width
    height: Math.max(placeLink.implicitHeight, standLabel.implicitHeight)
    Link {
      id: placeLink
      readonly property string place: view.report ? view.report.place : view.weather.place ? view.weather.place.name : ""
      width: Math.min(implicitWidth, parent.width - standLabel.implicitWidth - Theme.s(12))
      text: WeatherLogic.glyph("place") + " " + (place || Theme.t("weather.title"))
      name: place ? Theme.t("weather.changePlace", place) : Theme.t("weather.setPlace")
      elide: Text.ElideRight
      onActivated: view.picking = true
    }
    Label {
      id: standLabel
      anchors.right: parent.right
      text: view.weather.failed ? "" : WeatherLogic.stand(view.report, false, view.now, Theme.lang)
      color: Theme.muted
      font.pixelSize: Theme.fCaption
      font.features: { "tnum": 1 }
    }
  }
  // Offline with older weather: from when, on a line of its own.
  Label {
    visible: !view.picking && view.weather.failed && !!view.report
    width: parent.width
    text: WeatherLogic.stand(view.report, true, view.now, Theme.lang)
    color: Theme.urgent
    font.pixelSize: Theme.fCaption
    wrapMode: Text.WordWrap
  }

  // Now: the sky as a glyph and in a word, the temperature large.
  Row {
    visible: !view.picking && view.state === "ok"
    spacing: Theme.s(12)
    Label {
      anchors.verticalCenter: parent.verticalCenter
      text: WeatherLogic.glyph(view.report ? view.report.icon : "")
      font.pixelSize: Theme.s(44)
      Accessible.ignored: true
    }
    Column {
      anchors.verticalCenter: parent.verticalCenter
      spacing: Theme.s(2)
      Label {
        text: view.report ? WeatherLogic.degrees(view.report.temp) : ""
        font.pixelSize: Theme.s(30)
        font.weight: Font.DemiBold
        font.features: { "tnum": 1 }
      }
      Label {
        text: view.report ? [WeatherLogic.condition(view.report.icon, Theme.lang)]
          .concat(view.report.feels !== null ? [Theme.t("weather.feels", WeatherLogic.degrees(view.report.feels))] : []).join(", ") : ""
      }
      Label {
        visible: !!view.report && view.report.high !== null
        text: view.report ? Theme.t("weather.today", WeatherLogic.degrees(view.report.low), WeatherLogic.degrees(view.report.high)) : ""
        color: Theme.muted
        font.pixelSize: Theme.fCaption
      }
    }
  }

  // Rain in the next two hours: one bar per step, height by strength.
  Column {
    id: rain
    readonly property var r: view.report ? WeatherLogic.upcoming(view.report.rain, view.now) : null
    visible: !view.picking && view.state === "ok" && !!r
    width: parent.width
    spacing: Theme.s(6)
    Label {
      id: rainText
      width: parent.width
      text: WeatherLogic.rainText(WeatherLogic.rainState(rain.r), view.now, Theme.lang)
      wrapMode: Text.WordWrap
    }
    Row {
      id: bars
      readonly property int count: rain.r ? rain.r.frames.length : 0
      readonly property real gap: Theme.s(count > 12 ? 2 : 4)
      width: parent.width
      height: Theme.s(28)
      spacing: gap
      Accessible.role: Accessible.Graphic
      Accessible.name: Theme.t("weather.rain.bars")
      Accessible.description: rainText.text
      Repeater {
        model: rain.r ? rain.r.frames : []
        Item {
          required property var modelData
          width: (bars.width - bars.gap * (bars.count - 1)) / Math.max(1, bars.count)
          height: bars.height + view.grow
          Rectangle {
            readonly property bool wet: parent.modelData.mmh >= WeatherLogic.wet
            anchors.bottom: parent.bottom
            width: parent.width
            // dry: a flat mark, so the row reads as time even without rain
            height: wet ? Math.max(Theme.s(6), parent.height * WeatherLogic.rainHeight(parent.modelData.mmh)) : Theme.s(2)
            radius: Math.min(width / 2, Theme.s(2))
            color: wet ? Theme.accentText : Util.alpha(Theme.fg, 0.25)
          }
        }
      }
    }
    Item {
      width: parent.width
      height: nowLabel.implicitHeight
      transform: Translate { y: view.grow }
      Label { id: nowLabel; text: Theme.t("weather.now"); color: Theme.muted; font.pixelSize: Theme.fCaption }
      Label {
        anchors.right: parent.right
        readonly property var f: rain.r ? rain.r.frames : []
        text: f.length ? WeatherLogic.clock(f[f.length - 1].t + rain.r.step, view.now, Theme.lang) : ""
        color: Theme.muted
        font.pixelSize: Theme.fCaption
        font.features: { "tnum": 1 }
      }
      // The next six hours: hour, sky, temperature.
      Item {
        y: nowLabel.implicitHeight + Theme.s(16)
        width: parent.width
        height: hourRow.implicitHeight
        visible: view.showHours
        Accessible.role: Accessible.StaticText
        Accessible.name: Theme.t("weather.hours")
        Accessible.description: view.hours.map(function(h) {
          return Theme.t("weather.hour", WeatherLogic.hourLabel(h.t, Theme.lang, view.weather.twelveHour),
                         WeatherLogic.condition(h.icon, Theme.lang), WeatherLogic.degrees(h.temp))
        }).join("; ")
        Row {
          id: hourRow
          width: parent.width
          Repeater {
            model: view.hours
            Column {
              required property var modelData
              width: hourRow.width / 6
              spacing: Theme.s(4)
              Label {
                width: parent.width
                horizontalAlignment: Text.AlignHCenter
                text: WeatherLogic.hourLabel(parent.modelData.t, Theme.lang, view.weather.twelveHour)
                color: Theme.muted
                font.pixelSize: Theme.fCaption
                font.features: { "tnum": 1 }
                Accessible.ignored: true
              }
              Label {
                width: parent.width
                horizontalAlignment: Text.AlignHCenter
                text: WeatherLogic.glyph(parent.modelData.icon)
                font.pixelSize: Theme.s(20)
                Accessible.ignored: true
              }
              Label {
                width: parent.width
                horizontalAlignment: Text.AlignHCenter
                text: WeatherLogic.degrees(parent.modelData.temp)
                font.features: { "tnum": 1 }
                Accessible.ignored: true
              }
            }
          }
        }
      }
    }
  }

  // The DWD's warnings (only in Germany): level in words, not only colour.
  Column {
    readonly property var list: view.report && view.report.alerts ? view.report.alerts.slice(0, 3) : []
    visible: !view.picking && view.state === "ok" && !!view.report && view.report.alerts !== null
    width: parent.width
    spacing: Theme.s(8)
    transform: Translate { y: view.drop }
    Label {
      visible: parent.list.length === 0
      text: Theme.t("weather.noAlerts")
      color: Theme.muted
      font.pixelSize: Theme.fCaption
    }
    Repeater {
      model: parent.list
      Row {
        required property var modelData
        width: parent.width
        spacing: Theme.s(10)
        Accessible.role: Accessible.StaticText
        Accessible.name: WeatherLogic.alertTitle(modelData, Theme.lang) + ", " + WeatherLogic.alertWhen(modelData, view.now, Theme.lang)
        Label {
          text: WeatherLogic.glyph("alert")
          color: parent.modelData.level >= 2 ? Theme.urgent : Theme.fg
          font.pixelSize: Theme.s(20)
          Accessible.ignored: true
        }
        Column {
          width: parent.width - Theme.s(30)
          spacing: Theme.s(1)
          Label {
            width: parent.width
            text: WeatherLogic.alertTitle(parent.parent.modelData, Theme.lang)
            font.weight: Font.DemiBold
            elide: Text.ElideRight
          }
          Label {
            width: parent.width
            text: WeatherLogic.alertWhen(parent.parent.modelData, view.now, Theme.lang)
            color: Theme.muted
            font.pixelSize: Theme.fCaption
            wrapMode: Text.WordWrap
          }
        }
      }
    }
  }

  // Loading: the shape of what comes.
  Column {
    visible: !view.picking && view.state === "loading"
    width: parent.width
    spacing: Theme.s(10)
    Row {
      spacing: Theme.s(12)
      Rectangle { width: Theme.s(44); height: width; radius: Theme.radius; color: Util.alpha(Theme.fg, 0.08) }
      Column {
        anchors.verticalCenter: parent.verticalCenter
        spacing: Theme.s(8)
        Rectangle { width: Theme.s(64); height: Theme.s(22); radius: Theme.s(4); color: Util.alpha(Theme.fg, 0.08) }
        Rectangle { width: Theme.s(120); height: Theme.s(10); radius: Theme.s(4); color: Util.alpha(Theme.fg, 0.08) }
      }
    }
    Rectangle { width: parent.width; height: Theme.s(28); radius: Theme.s(4); color: Util.alpha(Theme.fg, 0.05) }
    Label { text: Theme.t("weather.loading"); color: Theme.muted; font.pixelSize: Theme.fCaption }
  }

  // Failed with nothing to show, or no place: what is wrong, the one way on.
  Column {
    visible: !view.picking && (view.state === "error" || view.state === "noPlace")
    width: parent.width
    spacing: Theme.s(8)
    Label {
      width: parent.width
      text: Theme.t(view.state === "noPlace" ? "weather.noPlace" : "weather.error")
      wrapMode: Text.WordWrap
    }
    Link {
      text: Theme.t(view.state === "noPlace" ? "weather.setPlace" : "weather.retry")
      onActivated: view.state === "noPlace" ? view.picking = true : view.weather.refresh()
    }
  }

  // The place search: a name, Enter, pick one; or back to automatic.
  Column {
    visible: view.picking
    width: parent.width
    spacing: Theme.s(8)
    onVisibleChanged: if (visible) { searchField.text = ""; Qt.callLater(function() { searchField.focusInput() }) }
    InputField {
      id: searchField
      width: parent.width
      fieldHeight: Theme.s(36)
      placeholder: Theme.t("weather.search")
      onAccepted: view.weather.search(text)
    }
    Label {
      visible: ["searching", "empty", "failed"].indexOf(view.weather.searchState) !== -1
      width: parent.width
      text: Theme.t(view.weather.searchState === "searching" ? "weather.searching"
        : view.weather.searchState === "empty" ? "weather.searchEmpty" : "weather.searchFailed")
      color: view.weather.searchState === "failed" ? Theme.urgent : Theme.muted
      font.pixelSize: Theme.fCaption
      wrapMode: Text.WordWrap
    }
    Repeater {
      model: view.weather.found
      PlaceRow {
        required property var modelData
        title: modelData.name
        detail: modelData.region
        onActivated: { view.weather.pick(modelData); view.picking = false }
      }
    }
    PlaceRow {
      title: Theme.t("weather.auto")
      onActivated: { view.weather.automatic(); view.picking = false }
    }
    Link {
      text: Theme.t("cancel")
      onActivated: { view.picking = false; view.weather.endSearch() }
    }
  }

  // One choice in the search: the name, where it is.
  component PlaceRow: Rectangle {
    id: row
    property string title: ""
    property string detail: ""
    signal activated()
    width: parent ? parent.width : 0
    height: rowText.implicitHeight + Theme.s(12)
    radius: Theme.radius
    color: rowClick.containsMouse ? Util.alpha(Theme.fg, 0.08) : "transparent"
    Behavior on color { ColorAnimation { duration: 120 } }
    Column {
      id: rowText
      x: Theme.s(8)
      width: parent.width - Theme.s(16)
      anchors.verticalCenter: parent.verticalCenter
      Label { width: parent.width; text: row.title; elide: Text.ElideRight }
      Label { visible: row.detail !== ""; width: parent.width; text: row.detail; color: Theme.muted; font.pixelSize: Theme.fCaption; elide: Text.ElideRight }
    }
    Click {
      id: rowClick
      anchors.fill: parent
      ringRadius: row.radius
      name: row.detail ? row.title + ", " + row.detail : row.title
      onActivated: row.activated()
    }
  }
}
