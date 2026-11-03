import QtQuick
import qs.Commons
import "../theme"

// One choice out of a few, side by side (settings page), wrapping into more
// lines past maxWidth. The chosen one is light on dark, like the primary button.
//   options: [{ value, label, font (optional: the label's family) }],
//   value: the chosen one, picked(value)
Rectangle {
  id: segments
  property var options: []
  property var value
  property real maxWidth: 100000
  signal picked(var value)
  width: segRow.childrenRect.width + Theme.s(6)
  height: segRow.childrenRect.height + Theme.s(6)
  radius: Theme.radius
  color: Util.alpha(Theme.fg, 0.07)

  Flow {
    id: segRow
    x: Theme.s(3)
    y: Theme.s(3)
    width: segments.maxWidth - Theme.s(6)
    spacing: Theme.s(2)

    Repeater {
      model: segments.options

      Rectangle {
        id: seg
        required property var modelData
        readonly property bool chosen: modelData.value === segments.value
        width: segText.implicitWidth + Theme.s(20)
        // (one height for every font, so wrapped lines stay even)
        height: Math.round(Theme.s(12) * 1.3) + Theme.s(10)
        radius: Theme.radius
        color: chosen ? Theme.fg : segMouse.containsMouse ? Util.alpha(Theme.fg, 0.1) : "transparent"
        Behavior on color { ColorAnimation { duration: 120 } }

        Text {
          id: segText
          anchors.centerIn: parent
          text: seg.modelData.label
          color: seg.chosen ? Theme.bg : Theme.fg
          font.family: seg.modelData.font || Theme.fontFamily
          font.pixelSize: Theme.s(12)
          font.weight: seg.chosen ? Font.DemiBold : Font.Medium
        }
        Click {
          id: segMouse
          anchors.fill: parent
          ringRadius: seg.radius
          cursorShape: seg.chosen ? Qt.ArrowCursor : Qt.PointingHandCursor
          name: seg.modelData.label
          Accessible.role: Accessible.RadioButton
          Accessible.checkable: true
          Accessible.checked: seg.chosen
          onActivated: if (!seg.chosen) segments.picked(seg.modelData.value)
        }
      }
    }
  }
}
