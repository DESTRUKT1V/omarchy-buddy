import QtQuick
import "../theme"

// A small text that acts (a link, "×", the pager's arrows): muted, the text
// colour under the pointer. The click area reaches beyond the text (B16:
// at least 24 px) without moving anything.
Label {
  id: link
  property string name: text
  property real reach: Theme.s(6)
  property alias key: area.key
  signal activated()
  font.pixelSize: Theme.fCaption
  color: area.containsMouse ? Theme.fg : Theme.muted
  Click {
    id: area
    anchors.fill: parent
    anchors.margins: -link.reach
    name: link.name
    onActivated: link.activated()
  }
}
