import QtQuick
import "../theme"

// One line in a fixed width (so the island does not twitch with every
// tool): text that does not fit scrolls slowly to its end and back once
// per text, time-based, then ends in "…" (#156: an endless scroll redraws
// the island all the time). It stands still while paused (and starts over
// afterwards) and with "Weniger Bewegung" (then "…" at once).
Item {
  id: marquee
  property string text: ""
  property bool paused: false
  property color color: Theme.muted
  property bool done: false  // this text has scrolled once
  readonly property real overflow: Math.max(0, line.implicitWidth - width)
  implicitHeight: line.implicitHeight
  clip: true

  Label {
    id: line
    readonly property bool still: Theme.reduceMotion || marquee.done
    width: still ? marquee.width : implicitWidth
    elide: still ? Text.ElideRight : Text.ElideNone
    text: marquee.text
    color: marquee.color
    font.pixelSize: Theme.fCaption
  }

  SequentialAnimation {
    id: scroll
    running: marquee.visible && !marquee.paused && !Theme.reduceMotion && !marquee.done && marquee.overflow > 0
    PauseAnimation { duration: 1400 }
    NumberAnimation {
      target: line; property: "x"; from: 0; to: -marquee.overflow
      duration: Math.max(600, marquee.overflow / 45 * 1000)
    }
    PauseAnimation { duration: 1400 }
    NumberAnimation { target: line; property: "x"; to: 0; duration: 350; easing.type: Easing.OutCubic }
    onRunningChanged: if (!running) line.x = 0
    onFinished: marquee.done = true
  }

  // A new tool starts reading from the beginning.
  onTextChanged: {
    done = false
    line.x = 0
    if (scroll.running) scroll.restart()
  }
}
