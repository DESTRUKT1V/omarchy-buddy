import QtQuick
import "../theme"

// ‹ 2/3 › when more than one thing waits.
Row {
  id: pager
  required property var app
  readonly property var sessions: app.sessions
  visible: sessions.asks.length > 1
  spacing: Theme.s(4)
  Link { text: "󰅁"; name: Theme.t("a11y.prev"); font.pixelSize: Theme.fTitle; leftPadding: Theme.s(5); rightPadding: Theme.s(5); anchors.verticalCenter: parent.verticalCenter; onActivated: pager.sessions.pageAsk(-1) }
  Label {
    anchors.verticalCenter: parent.verticalCenter
    text: (pager.sessions.askPos + 1) + "/" + pager.sessions.asks.length
    font.pixelSize: Theme.fCaption
    color: Theme.muted
  }
  Link { text: "󰅂"; name: Theme.t("a11y.next"); font.pixelSize: Theme.fTitle; leftPadding: Theme.s(5); rightPadding: Theme.s(5); anchors.verticalCenter: parent.verticalCenter; onActivated: pager.sessions.pageAsk(1) }
}
