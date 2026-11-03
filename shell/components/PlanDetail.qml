import QtQuick
import "../theme"
import "../SessionLogic.js" as SessionLogic

// Claude's plan (ExitPlanMode) as formatted text: the beginning, a click
// shows all of it, scrolling when long.
Column {
  id: detail
  required property var app
  property var ask: ({})
  property string keys: ""
  readonly property var request: ask && ask.request ? ask.request : null
  readonly property bool expanded: app.sessions.expandedKey !== "" && app.sessions.expandedKey === (ask ? ask.key : "")
  readonly property real shortHeight: Theme.s(96)
  readonly property real longHeight: Theme.s(320)
  readonly property bool canExpand: planText.implicitHeight > shortHeight
  spacing: Theme.s(5)

  ScrollBox {
    width: parent.width
    contentHeight: planText.implicitHeight
    maxHeight: detail.expanded ? detail.longHeight : detail.shortHeight
    scrolls: detail.expanded
    Behavior on height { NumberAnimation { duration: Theme.reduceMotion ? 0 : 260; easing.type: Easing.OutCubic } }

    Text {
      id: planText
      width: parent.width
      text: detail.request ? SessionLogic.planLinks(SessionLogic.planMarkdown(detail.request.full), Theme.accentText) : ""
      textFormat: Text.MarkdownText
      wrapMode: Text.WrapAtWordBoundaryOrAnywhere
      color: Theme.fg  // 85 % fell under 4.5:1 in light themes (rose-pine)
      font.family: Theme.fontFamily
      font.pixelSize: Theme.fBody
      onLinkActivated: function(link) { if (/^(https?|mailto):/i.test(link)) Qt.openUrlExternally(link) }  // never file: or .desktop
    }
  }
  Link {
    visible: detail.canExpand
    key: detail.keys ? detail.keys + "|" + detail.ask.key + "|more" : ""
    text: detail.expanded ? Theme.t("more.less") : Theme.t("more.plan")
    onActivated: { detail.app.sessions.expandedKey = detail.expanded ? "" : detail.ask.key; detail.app.touch() }
  }
}
