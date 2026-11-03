import QtQuick
import qs.Commons
import "../theme"

// A box for a long text (the whole command, the plan, a diff, a text field):
// as tall as `contentHeight` up to `maxHeight`, then it scrolls (while
// `scrolls`), with the fade at the bottom while more lies below. padX/padY
// unscaled: Theme.s(2 * pad) rounds as the old boxes did, not 2 * Theme.s(pad).
Rectangle {
  id: box
  default property alias content: boxFlick.flickableData
  property alias contentHeight: boxFlick.contentHeight
  readonly property Flickable flick: boxFlick
  property real maxHeight: Theme.s(320)
  property real padX: 10
  property real padY: 8
  property bool scrolls: true
  height: Math.min(contentHeight, maxHeight) + Theme.s(padY * 2)
  radius: Theme.radius
  color: Util.alpha(Theme.fg, 0.06)
  clip: true

  Flickable {
    id: boxFlick
    x: Theme.s(box.padX); y: Theme.s(box.padY)
    width: parent.width - Theme.s(box.padX * 2)
    height: parent.height - Theme.s(box.padY * 2)
    interactive: box.scrolls && contentHeight > height
    boundsBehavior: Flickable.StopAtBounds
    clip: true
  }
  ScrollFade { flick: boxFlick }
}
