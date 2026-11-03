import QtQuick
import "../theme"
import "../SessionLogic.js" as SessionLogic

// What is asked: Claude's own words when it gave some ("Build-Ordner
// leeren", #193), the command under them in mono; one or two lines, a click
// shows the whole command (and what "Immer erlauben" would remember),
// scrolling in its box when long.
Column {
  id: detail
  required property var app
  property var ask: ({})
  property string keys: ""
  property int lines: 2
  readonly property var request: ask && ask.request ? ask.request : null
  readonly property bool expanded: app.sessions.expandedKey !== "" && app.sessions.expandedKey === (ask ? ask.key : "")
  readonly property string shortText: SessionLogic.askText(ask, Theme.lang)
  readonly property string about: request ? request.description : ""
  readonly property bool canExpand: request !== null && (shortLabel.truncated || request.full !== request.detail || request.always !== "")
  visible: shortText !== ""
  spacing: Theme.s(5)

  Label {
    visible: detail.about !== ""
    width: parent.width
    text: detail.about
    wrapMode: Text.WrapAtWordBoundaryOrAnywhere
    maximumLineCount: detail.lines
    elide: Text.ElideRight
    font.weight: Font.Medium
  }
  Label {
    id: shortLabel
    visible: !detail.expanded
    width: parent.width
    text: detail.about ? detail.request.detail : detail.shortText
    wrapMode: Text.WrapAtWordBoundaryOrAnywhere
    maximumLineCount: detail.lines
    elide: Text.ElideRight
    color: Theme.fg  // 80 % fell under 4.5:1 in light themes (rose-pine)
    font.family: detail.about ? "monospace" : Theme.fontFamily
  }
  // A long command scrolls in its own box, like the plan, so the notes
  // below and "weniger" stay in sight.
  ScrollBox {
    visible: detail.expanded
    width: parent.width
    contentHeight: fullText.implicitHeight
    Label {
      id: fullText
      width: parent.width
      text: detail.request ? (detail.request.tool ? detail.request.tool + ":\n" : "") + detail.request.full : ""
      font.family: "monospace"
      font.pixelSize: Theme.fCaption
      wrapMode: Text.WrapAtWordBoundaryOrAnywhere
    }
  }
  // The hook keeps only the start of very long commands.
  Label {
    visible: detail.expanded && detail.request !== null && detail.request.truncated
    width: parent.width
    text: Theme.t("ask.truncated")
    wrapMode: Text.WrapAtWordBoundaryOrAnywhere
    color: Theme.urgent
    font.pixelSize: Theme.fCaption
    font.weight: Font.Medium
  }
  Label {
    visible: detail.expanded && detail.request !== null && detail.request.always !== ""
    width: parent.width
    text: Theme.t("always.remembers", detail.request ? detail.request.always : "")
    wrapMode: Text.WrapAtWordBoundaryOrAnywhere
    color: Theme.muted
    font.pixelSize: Theme.fCaption
  }
  Link {
    visible: detail.canExpand
    key: detail.keys ? detail.keys + "|" + detail.ask.key + "|more" : ""
    text: detail.expanded ? Theme.t("more.less") : Theme.t("more.command")
    onActivated: { detail.app.sessions.expandedKey = detail.expanded ? "" : detail.ask.key; detail.app.touch() }
  }
}
