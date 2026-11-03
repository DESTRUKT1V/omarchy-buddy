import QtQuick
import qs.Commons
import "../theme"

// A pill. The primary one is light on dark; pressing squeezes it a bit
// (not with "Weniger Bewegung"). `name` for an icon alone (the gear).
Rectangle {
  id: action
  property string label: ""
  property bool strong: false
  property string name: label
  property alias key: actionMouse.key
  signal clicked()
  width: actionText.implicitWidth + Theme.s(28)
  height: actionText.implicitHeight + Theme.s(14)
  radius: Theme.radius
  color: strong ? (actionMouse.containsMouse ? Util.alpha(Theme.fg, 0.85) : Theme.fg)
    : actionMouse.containsMouse ? Util.alpha(Theme.fg, 0.15) : Util.alpha(Theme.fg, 0.09)
  opacity: enabled ? 1 : 0.4
  scale: actionMouse.pressed && !Theme.reduceMotion ? 0.94 : 1
  Behavior on scale { NumberAnimation { duration: 90 } }
  Behavior on color { ColorAnimation { duration: 120 } }

  Label {
    id: actionText
    anchors.centerIn: parent
    text: action.label  // from apps too: Label never reads HTML
    color: action.strong ? Theme.bg : Theme.fg
    font.pixelSize: Theme.s(12.5)
    font.weight: action.strong ? Font.DemiBold : Font.Medium
  }
  Click {
    id: actionMouse
    anchors.fill: parent
    anchors.margins: -Theme.s(3)
    ringRadius: Theme.ring(action.radius)
    name: action.name
    onActivated: action.clicked()
  }
}
