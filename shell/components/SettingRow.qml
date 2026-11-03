import QtQuick
import "../theme"

// One line of the settings page: what it is on the left (with a muted
// `hint` under it, if any), the control (Segments, Toggle) on the right.
Item {
  id: row
  property string label: ""
  property string hint: ""
  default property alias control: slot.data
  width: parent ? parent.width : 0
  height: Math.max(texts.implicitHeight, slot.childrenRect.height) + Theme.s(10)

  Column {
    id: texts
    anchors.left: parent.left
    anchors.leftMargin: Theme.s(4)
    anchors.verticalCenter: parent.verticalCenter
    width: parent.width - slot.childrenRect.width - Theme.s(16)
    Label {
      width: parent.width
      text: row.label
      elide: Text.ElideMiddle
    }
    Label {
      visible: row.hint !== ""
      width: parent.width
      text: row.hint
      elide: Text.ElideRight
      color: Theme.muted
      font.pixelSize: Theme.fCaption
    }
  }
  Item {
    id: slot
    anchors.right: parent.right
    anchors.verticalCenter: parent.verticalCenter
    width: childrenRect.width
    height: childrenRect.height
  }
}
