import QtQuick
import QtQuick.Effects
import qs.Commons
import "../theme"

// A picture sent along (avatar, cover, screenshot) with rounded corners,
// whole and fitted into size × size; hidden when it is gone, or a quiet
// placeholder while a cover loads.
Item {
  id: thumb
  property alias source: thumbImage.source
  property int size: 56
  property bool placeholder: false
  property bool show: true
  property real radius: Theme.radius
  readonly property bool ready: thumbImage.status === Image.Ready
  visible: show && (ready || placeholder)
  readonly property real ratio: ready && thumbImage.implicitHeight > 0 ? thumbImage.implicitWidth / thumbImage.implicitHeight : 1
  width: Math.round(size * Math.min(1, ratio)); height: Math.round(size * Math.min(1, 1 / ratio))

  Rectangle {
    anchors.fill: parent
    visible: !thumb.ready
    radius: thumb.radius
    color: Util.alpha(Theme.fg, 0.06)
    Label { anchors.centerIn: parent; text: "󰝚"; font.pixelSize: Math.round(thumb.size * 0.4); color: Theme.muted }
  }
  Image {
    id: thumbImage
    anchors.fill: parent
    sourceSize.width: thumb.size * 2; sourceSize.height: thumb.size * 2
    fillMode: Image.PreserveAspectFit
    asynchronous: true
    smooth: true
    visible: false
  }
  // Rounded corners: the picture is drawn through a rounded mask.
  MultiEffect {
    anchors.fill: parent
    visible: thumb.ready
    source: thumbImage
    maskEnabled: true
    maskSource: thumbMask
    maskThresholdMin: 0.5
    maskSpreadAtMin: 1.0
  }
  Rectangle {
    id: thumbMask
    width: thumb.width; height: thumb.height
    radius: thumb.radius
    visible: false
    layer.enabled: true
  }
}
