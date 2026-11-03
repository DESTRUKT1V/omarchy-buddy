import QtQuick
import QtQuick.Effects
import "../theme"

// A soft fade at the bottom of a Flickable while more lies below: the hint
// that it scrolls, without a scroll bar. Masks the content itself, so it fits
// any background. Itself only the (invisible) mask.
Item {
  id: fade
  required property Flickable flick
  readonly property bool on: flick.contentHeight > flick.height + 1 && !flick.atYEnd
  width: flick.width
  height: flick.height
  visible: false
  layer.enabled: true

  Rectangle {
    anchors.fill: parent
    gradient: Gradient {
      GradientStop { position: 0; color: "white" }
      GradientStop { position: Math.max(0, 1 - Theme.s(28) / Math.max(1, fade.height)); color: "white" }
      GradientStop { position: 1; color: "transparent" }
    }
  }

  Binding { target: fade.flick; property: "layer.enabled"; value: fade.on }
  Component {
    id: masked
    // Threshold 0.5 with spread 1: mask alpha 0…1 maps linearly to 0…1.
    MultiEffect { maskEnabled: true; maskSource: fade; maskThresholdMin: 0.5; maskSpreadAtMin: 1 }
  }
  Component.onCompleted: flick.layer.effect = masked
}
