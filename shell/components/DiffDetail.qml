import QtQuick
import "../theme"
import "../DiffLogic.js" as DiffLogic

// A file change before it is allowed (Edit, Write …): the file and its line
// counts, then the diff in its own box like the plan. Removed and added lines
// carry "−" and "+" besides their colour (DiffLogic.colors); long lines wrap.
Column {
  id: detail
  required property var app
  property var ask: ({})
  property string keys: ""
  readonly property var request: ask && ask.request ? ask.request : null
  readonly property var d: DiffLogic.diff(request ? request.edits : [])
  readonly property bool created: request !== null && request.edits && request.edits.length > 0 && request.edits[0].created === true
  readonly property bool expanded: app.sessions.expandedKey !== "" && app.sessions.expandedKey === (ask ? ask.key : "")
  readonly property real shortHeight: Theme.s(120)
  readonly property real longHeight: Theme.s(320)
  readonly property var ink: DiffLogic.colors(Theme.fg, Theme.bg, Theme.light)
  function rgb(c) { return Qt.rgba(c.r, c.g, c.b, 1) }
  readonly property bool canExpand: rowsColumn.implicitHeight > shortHeight || (request !== null && request.always !== "")
  spacing: Theme.s(5)

  Item {
    width: parent.width
    height: titleLabel.implicitHeight
    Label {
      id: titleLabel
      anchors.left: parent.left
      anchors.right: countsLabel.left
      anchors.rightMargin: Theme.s(10)
      text: DiffLogic.title(detail.d, detail.created, detail.ask && detail.ask.session ? detail.ask.session.cwd : "", Theme.lang)
      elide: Text.ElideLeft  // the file's name stays in sight
      font.weight: Font.Medium
    }
    Row {
      id: countsLabel
      anchors.right: parent.right
      anchors.verticalCenter: parent.verticalCenter
      spacing: Theme.s(6)
      Label { visible: detail.d.added > 0; text: "+" + detail.d.added; color: detail.rgb(detail.ink.addInk); font.family: "monospace"; font.pixelSize: Theme.fCaption }
      Label { visible: detail.d.removed > 0; text: "−" + detail.d.removed; color: detail.rgb(detail.ink.delInk); font.family: "monospace"; font.pixelSize: Theme.fCaption }
    }
  }

  ScrollBox {
    visible: detail.d.rows.length > 0
    width: parent.width
    contentHeight: rowsColumn.implicitHeight
    maxHeight: detail.expanded ? detail.longHeight : detail.shortHeight
    scrolls: detail.expanded
    padX: 0; padY: 6
    Behavior on height { NumberAnimation { duration: Theme.reduceMotion ? 0 : 260; easing.type: Easing.OutCubic } }

    Column {
      id: rowsColumn
      width: parent.width
      Repeater {
        model: detail.d.rows
        Rectangle {
          id: row
          required property var modelData
          readonly property string kind: modelData.kind
          width: rowsColumn.width
          height: Math.max(sign.implicitHeight, line.implicitHeight)
          color: kind === "add" ? detail.rgb(detail.ink.addRow) : kind === "del" ? detail.rgb(detail.ink.delRow) : "transparent"
          Text {
            id: sign
            x: Theme.s(8)
            width: Theme.s(12)
            text: row.kind === "add" ? "+" : row.kind === "del" ? "−" : ""
            color: detail.rgb(row.kind === "add" ? detail.ink.addInk : detail.ink.delInk)
            font.family: "monospace"
            font.pixelSize: Theme.fCaption
            font.weight: Font.DemiBold
          }
          Text {
            id: line
            x: Theme.s(22)
            width: row.width - x - Theme.s(10)
            text: row.kind === "gap" ? DiffLogic.gapText(row.modelData.count, Theme.lang) : row.modelData.text
            textFormat: Text.PlainText
            wrapMode: Text.WrapAtWordBoundaryOrAnywhere
            color: row.kind === "gap" ? Theme.muted : Theme.fg
            font.family: row.kind === "gap" || row.kind === "file" ? Theme.fontFamily : "monospace"
            font.pixelSize: Theme.fCaption
            font.italic: row.kind === "gap"
            font.weight: row.kind === "file" ? Font.Medium : Font.Normal
            topPadding: row.kind === "file" || row.kind === "gap" ? Theme.s(3) : 0
            bottomPadding: topPadding
          }
        }
      }
    }
  }
  // What did not fit: rows beyond DiffLogic.maxRows, or edits the hook left out.
  Label {
    visible: detail.d.cut > 0 || (detail.request !== null && detail.request.editsCut)
    width: parent.width
    text: detail.d.rows.length === 0 ? Theme.t("diff.tooBig")
          : detail.d.cut > 0 ? Theme.t("diff.cut", detail.d.cut) : Theme.t("ask.truncated")
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
    text: detail.expanded ? Theme.t("more.less") : Theme.t("more.diff")
    onActivated: { detail.app.sessions.expandedKey = detail.expanded ? "" : detail.ask.key; detail.app.touch() }
  }
}
