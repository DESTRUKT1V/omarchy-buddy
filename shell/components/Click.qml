import QtQuick
import "../theme"

// Where a click acts, also for the keyboard while the island has it (the
// user clicked into it, F9): Tab reaches it, Enter or Space acts like a
// click, a ring in the accent colour shows the focus. `name` is what a
// screen reader says. Callers use onActivated (mouse or key). In a list that
// is rebuilt, `key` (unique, stable) keeps the focus on the same target.
MouseArea {
  id: click
  property string name: ""
  property string key: ""
  property real ringRadius: Theme.radius
  signal activated()
  hoverEnabled: true
  cursorShape: Qt.PointingHandCursor
  activeFocusOnTab: enabled
  onClicked: activated()
  Keys.onReturnPressed: activated()
  Keys.onEnterPressed: activated()
  Keys.onSpacePressed: activated()
  Accessible.role: Accessible.Button
  Accessible.name: name
  Accessible.onPressAction: activated()

  Component.onCompleted: {
    if (!key) return
    Theme.clicks[key] = click
    // Asked for before it was made (a list built as the open view opens).
    if (Theme.lostKey === key && visible) Qt.callLater(Theme.refocus)
  }
  // Asked for while hidden (the open view still fading in): take it on showing.
  onVisibleChanged: if (visible && key && Theme.lostKey === key) Theme.refocus()
  Component.onDestruction: {
    if (!key) return
    if (Theme.clicks[key] === click) delete Theme.clicks[key]
    if (activeFocus) { Theme.lostKey = key; Qt.callLater(Theme.refocus) }
  }

  // In a scrolling list the focused target scrolls into sight.
  onActiveFocusChanged: {
    if (!activeFocus) return
    for (var p = parent; p; p = p.parent) {
      if (!(p instanceof Flickable)) continue
      var top = mapToItem(p.contentItem, 0, 0).y
      var max = Math.max(0, p.contentHeight - p.height)
      if (top < p.contentY) p.contentY = Math.max(0, top)
      else if (top + height > p.contentY + p.height) p.contentY = Math.min(max, top + height - p.height)
      return
    }
  }

  Rectangle {
    visible: click.activeFocus
    anchors.fill: parent
    radius: click.ringRadius
    color: "transparent"
    border.width: Theme.s(2)
    border.color: Theme.accentText
  }
}
