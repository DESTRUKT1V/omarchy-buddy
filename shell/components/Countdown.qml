import QtQuick
import qs.Commons
import "../theme"
import "../SessionLogic.js" as SessionLogic

// How long the island can still answer. The bar shrinks smoothly between
// the one-second ticks; after that the terminal asks.
Column {
  id: countdown
  required property var app
  property var ask: ({})
  readonly property var request: ask && ask.request ? ask.request : null
  readonly property real remaining: request ? Math.max(0, request.until - app.now) : 0
  spacing: Theme.s(5)

  Rectangle {
    visible: countdown.request !== null
    width: parent.width
    height: Theme.s(3)
    radius: height / 2
    color: Util.alpha(Theme.fg, 0.1)
    Rectangle {
      height: parent.height
      radius: parent.radius
      color: countdown.remaining <= 10 ? Theme.urgent : Util.alpha(Theme.fg, 0.6)
      width: parent.width * Math.min(1, countdown.remaining / Math.max(1, countdown.request ? countdown.request.wait : 30))
      Behavior on width { NumberAnimation { duration: 1000 } }
    }
  }
  Label {
    text: countdown.request ? SessionLogic.countdownText(countdown.remaining, Theme.lang)
      : Theme.t("sessions.terminal")
    color: countdown.request ? Theme.muted : Theme.accentText
    font.weight: countdown.request === null ? Font.DemiBold : Font.Normal
    font.pixelSize: Theme.fCaption
  }
}
