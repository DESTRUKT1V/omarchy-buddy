import QtQuick
import qs.Commons
import "../theme"

// An on/off switch (settings page): the knob slides (with "Weniger
// Bewegung" it jumps), the track fills. `name`: what it switches.
Rectangle {
  id: toggle
  property bool checked: false
  property string name: ""
  signal toggled(bool on)
  width: Theme.s(38)
  height: Theme.s(22)
  radius: Theme.radius
  color: checked ? Theme.fg : toggleMouse.containsMouse ? Util.alpha(Theme.fg, 0.16) : Util.alpha(Theme.fg, 0.1)
  Behavior on color { ColorAnimation { duration: 140 } }

  Rectangle {
    width: parent.height - Theme.s(6)
    height: width
    radius: Theme.radius
    y: Theme.s(3)
    x: toggle.checked ? toggle.width - width - Theme.s(3) : Theme.s(3)
    color: toggle.checked ? Theme.bg : Theme.muted
    Behavior on x { NumberAnimation { duration: Theme.reduceMotion ? 0 : 160; easing.type: Easing.OutCubic } }
  }
  Click {
    id: toggleMouse
    anchors.fill: parent
    anchors.margins: -Theme.s(6)
    ringRadius: Theme.ring(toggle.radius)
    name: toggle.name
    Accessible.role: Accessible.CheckBox
    Accessible.checkable: true
    Accessible.checked: toggle.checked
    onActivated: toggle.toggled(!toggle.checked)
  }
}
