import QtQuick
import "../theme"
import "../components"
import "../SessionLogic.js" as SessionLogic

// A Claude session waits for a decision (a permission, a question with
// options, a plan): stays until answered, pages through several requests
// (subagents ask in parallel). Only what is asked scrolls; O-Morchy with the
// name, countdown and buttons stay in place. O-Morchy sits in the head only,
// so a long request uses the full width below him.
Column {
  id: view
  required property var app
  property bool shown: false
  // Height the island leaves for this view (window minus a gap above and below).
  property real maxHeight: Theme.s(600)
  visible: opacity > 0
  opacity: shown ? 1 : 0
  scale: shown || Theme.reduceMotion ? 1 : 0.97
  Behavior on opacity { SequentialAnimation { PauseAnimation { duration: view.shown ? 140 : 0 } NumberAnimation { duration: view.shown ? 260 : 140; easing.type: Easing.OutCubic } } }
  Behavior on scale { NumberAnimation { duration: 280; easing.type: Easing.OutCubic } }
  spacing: Theme.s(7)
  width: Theme.s(440) + 17 * Theme.morchyPx(4) + Theme.s(14)
  readonly property var ask: view.app.sessions.currentAsk || ({ key: "", session: { name: "", requests: [] }, request: null })
  readonly property string askKey: ask.key
  onAskKeyChanged: bodyFlick.contentY = 0

  Item {
    id: head
    width: parent.width
    height: morchy.height
    OMorchy { id: morchy; paused: view.app.paused; px: Theme.morchyPx(4); mood: "needs"; emote: view.app.emote }
    Item {
      anchors.left: morchy.right
      anchors.leftMargin: Theme.s(14)
      anchors.right: parent.right
      anchors.verticalCenter: parent.verticalCenter
      height: needsTitle.implicitHeight
      Row {
        id: needsTitle
        spacing: Theme.s(8)
        // The asking agent's logo before the session's name.
        Label {
          id: needsMark
          anchors.baseline: needsName.baseline
          text: SessionLogic.agentMark(view.ask.session.agent)
          font.pixelSize: Theme.fTitle
          color: Theme.urgent
          Accessible.role: Accessible.StaticText
          Accessible.name: SessionLogic.agentName(view.ask.session.agent)
        }
        Label {
          id: needsName
          width: Math.min(implicitWidth, needsTitle.parent.width - needsMark.implicitWidth - Theme.s(8) - (needsAgent.visible ? needsAgent.implicitWidth + Theme.s(8) : 0)
                          - needsState.implicitWidth - (pager.visible ? pager.width : 0) - Theme.s(16))
          text: view.ask.session.name
          font.weight: Font.DemiBold
          font.pixelSize: Theme.fTitle
          elide: Text.ElideMiddle
        }
        Label {
          id: needsAgent
          visible: text !== ""
          anchors.baseline: needsState.baseline
          text: view.ask.request ? view.ask.request.agent : ""
          color: Theme.muted
          font.pixelSize: Theme.fCaption
        }
        Label {
          id: needsState
          anchors.baseline: needsName.baseline
          text: SessionLogic.askLabel(view.ask, Theme.lang)
          color: Theme.urgent
          font.weight: Font.Medium
        }
      }
      Pager {
        id: pager
        app: view.app
        anchors.right: parent.right
        anchors.verticalCenter: parent.verticalCenter
      }
    }
  }
  Flickable {
    id: bodyFlick
    width: parent.width
    height: Math.min(body.implicitHeight, Math.max(Theme.s(80),
      view.maxHeight - head.height - countdown.height - buttons.height - view.spacing * 3))
    contentHeight: body.implicitHeight
    interactive: contentHeight > height
    boundsBehavior: Flickable.StopAtBounds
    clip: true
    AskBody { id: body; app: view.app; width: parent.width; ask: view.ask; lines: 2 }
  }
  ScrollFade { flick: bodyFlick }
  Countdown { id: countdown; app: view.app; width: parent.width; ask: view.ask }
  RequestButtons { id: buttons; app: view.app; width: parent.width; session: view.ask.session; request: view.ask.request; topPadding: Theme.s(2) }
}
