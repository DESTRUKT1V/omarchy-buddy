import QtQuick
import qs.Commons
import "../theme"

// How many messages a bundle holds.
Rectangle {
  property int count: 0
  width: Math.max(height, badgeText.implicitWidth + Theme.s(10))
  height: badgeText.implicitHeight + Theme.s(2)
  radius: Theme.radius
  color: Util.alpha(Theme.accent, 0.22)
  Label {
    id: badgeText
    anchors.centerIn: parent
    text: parent.count
    font.pixelSize: Theme.fCaption
    font.weight: Font.DemiBold
    color: Theme.fg
  }
}
