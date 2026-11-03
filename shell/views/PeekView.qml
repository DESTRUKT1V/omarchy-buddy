import QtQuick
import "../theme"
import "../components"

// Pointer over the pill: O-Morchy waves and says what's up, and what Claude
// runs right now. "alles gelesen" clears the unread without opening.
Row {
  id: view
  required property var app
  property bool shown: false
  visible: opacity > 0
  opacity: shown ? 1 : 0
  scale: shown || Theme.reduceMotion ? 1 : 0.97
  Behavior on opacity { SequentialAnimation { PauseAnimation { duration: view.shown ? 140 : 0 } NumberAnimation { duration: view.shown ? 240 : 140; easing.type: Easing.OutCubic } } }
  Behavior on scale { NumberAnimation { duration: 260; easing.type: Easing.OutCubic } }
  spacing: Theme.s(10)

  OMorchy { px: Theme.morchyPx(2.5); mood: view.app.mood === "sleep" ? "idle" : view.app.mood; emote: view.app.emote || "wave"; paused: view.app.paused; anchors.verticalCenter: parent.verticalCenter }
  Column {
    anchors.verticalCenter: parent.verticalCenter
    spacing: Theme.s(1)
    Row {
      spacing: Theme.s(10)
      Label {
        id: summaryText
        // Long sender names cut, not a wider peek (#193).
        width: Math.min(implicitWidth, Theme.s(340))
        text: view.app.summary
        elide: Text.ElideRight
        font.weight: Font.Medium
      }
      Link {
        visible: view.app.unread.length > 0
        anchors.baseline: summaryText.baseline
        text: Theme.t("peek.allRead")
        onActivated: { view.app.markRead(); view.app.playEmote("squish", 260) }
      }
    }
    Label {
      visible: text !== ""
      width: Math.min(implicitWidth, Theme.s(340))
      text: view.app.sessions.ticker
      elide: Text.ElideRight
      color: Theme.muted
      font.pixelSize: Theme.fCaption
    }
  }
}
