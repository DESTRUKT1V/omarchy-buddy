import QtQuick
import "../theme"

// A small heading above a group, optionally with a link on the right.
Item {
  id: section
  property string text: ""
  property string link: ""
  property string linkName: link
  property real topPadding: 0
  signal linkClicked()
  width: parent ? parent.width : 0
  height: sectionLabel.implicitHeight + topPadding

  Label {
    id: sectionLabel
    x: Theme.s(4)
    y: section.topPadding
    text: section.text
    font.pixelSize: Theme.fCaption
    font.weight: Font.DemiBold
    color: Theme.muted
    Accessible.role: Accessible.Heading
  }
  Link {
    visible: section.link !== ""
    anchors.right: parent.right
    anchors.rightMargin: Theme.s(4)
    y: section.topPadding
    text: section.link
    name: section.linkName
    reach: Theme.s(8)
    onActivated: section.linkClicked()
  }
}
