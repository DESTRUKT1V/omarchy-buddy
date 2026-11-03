import QtQuick
import qs.Commons
import "../theme"
import "../components"
import "../SessionLogic.js" as SessionLogic

// The open view's section of agent sessions (Claude, Codex): one card per
// session (what it runs right now, its context once it fills up),
// with a block per open request. A click on the card goes to its terminal,
// "×" hides it until its next hook event. A long list folds the finished
// and quiet ones from the 8th on (SessionLogic.folded).
Column {
  id: view
  required property var app
  // The "Für dich" block's part (the waiting sessions, no title) or the list
  // below it (the others, SessionLogic.forYouPart).
  property bool forYou: false
  property bool gap: false  // something above the title
  // Until the first session came (#192): how one comes, and the agents found.
  readonly property bool empty: !forYou && !view.app.prefs.agentsSeen && view.app.sessions.sessions.length === 0
  readonly property bool lookAround: empty && view.app.mode === "open"
  onLookAroundChanged: if (lookAround) view.app.settings.checkAgents()
  visible: forYou ? view.app.sessions.needsCount > 0 : view.empty || view.app.sessions.shownCount > view.app.sessions.needsCount
  spacing: Theme.s(8)
  // Closed, the cards keep what they last showed instead of being rebuilt
  // with every hook event; opening brings them up to date.
  property var rows: []
  Binding on rows { when: view.app.mode === "open"; value: view.app.sessions.sessions; restoreMode: Binding.RestoreNone }
  // Rebuilt when a session moves between the block and the list, not with every tick of `now`.
  property var picked: []
  readonly property string pickedIds: SessionLogic.forYouPart(rows, view.app.now, forYou).map(function(s) { return s.id }).join("\n")
  function pick() { picked = SessionLogic.forYouPart(rows, view.app.now, forYou) }
  onRowsChanged: pick()
  onPickedIdsChanged: pick()

  // Omarchy's default agent; a click opens Omarchy's own choice (#131).
  SectionTitle {
    visible: !view.forYou
    topPadding: view.gap ? Theme.s(6) : 0
    text: Theme.t("sessions.title")
    link: view.app.sessions.defaultAgent ? Theme.t("sessions.default", view.app.sessions.defaultAgent) : ""
    linkName: Theme.t("a11y.defaultAgent", view.app.sessions.defaultAgent)
    onLinkClicked: view.app.sessions.pickDefaultAgent()
  }
  Column {
    visible: view.empty
    x: Theme.s(4)
    width: view.width - Theme.s(8)
    spacing: Theme.s(6)
    Label {
      width: parent.width
      text: Theme.t("sessions.empty")
      wrapMode: Text.WordWrap
    }
    Flow {
      id: foundFlow
      readonly property var found: SessionLogic.foundAgents(view.app.settings.agentsInstalled)
      visible: found.length > 0
      width: parent.width
      spacing: Theme.s(12)
      Label { text: Theme.t("sessions.found"); color: Theme.muted; font.pixelSize: Theme.fCaption }
      Repeater {
        model: foundFlow.found
        Label {
          required property var modelData
          text: modelData.mark + "  " + modelData.name
          color: Theme.muted
          font.pixelSize: Theme.fCaption
        }
      }
    }
  }
  Repeater {
    model: view.picked

    Rectangle {
      id: row
      required property var modelData
      readonly property string st: view.app.sessions.stateOf(modelData)
      readonly property bool needs: st === "needs"
      readonly property bool behind: view.app.sessions.background(modelData)
      readonly property bool ending: view.app.sessions.endingKey === modelData.id
      readonly property bool focusable: modelData.window !== "" || modelData.orca
      // With an open request only its buttons act (the card would end the wait).
      readonly property bool asking: !view.app.sessions.canHide(modelData)
      readonly property real hideSpace: hideRow.visible ? hideRow.width + Theme.s(8) : 0
      visible: view.app.sessions.shown(modelData) && !view.app.sessions.folded[modelData.id]
      width: view.width
      height: rowContent.implicitHeight + Theme.s(22)
      radius: Theme.radius
      color: needs ? Util.alpha(Theme.urgent, 0.12)
        : rowMouse.containsMouse && focusable ? Util.alpha(Theme.fg, 0.08) : "transparent"
      border.width: 1
      border.color: needs ? Util.alpha(Theme.urgent, 0.3) : "transparent"

      // Under the content: its buttons keep their own clicks.
      Click {
        id: rowMouse
        anchors.fill: parent
        enabled: row.focusable && !row.asking
        ringRadius: row.radius
        name: row.modelData.name
        key: "session|" + row.modelData.id
        onActivated: view.app.sessions.focusSession(row.modelData)
      }

      // The state's mark in a gutter left of the name, everything else aligned under the name.
      Item {
        x: Theme.s(14)
        y: rowContent.y + rowHead.y
        width: Theme.s(14)
        height: rowHead.height
        // "braucht dich": the agent's logo, as in the bar (not only a colour).
        Label {
          visible: row.needs
          anchors.centerIn: parent
          text: SessionLogic.agentMark(row.modelData.agent)
          font.pixelSize: Theme.fBody
          color: Theme.urgent
          Accessible.ignored: true  // the state is written below
        }
        Rectangle {
          visible: !row.needs
          anchors.centerIn: parent
          width: Theme.s(8); height: width; radius: width / 2
          color: row.modelData.error ? Theme.urgent
            : row.behind ? Theme.aside
            : row.st === "working" ? Theme.accent
            : row.st === "done" ? Theme.good : Theme.muted
        }
      }

      Column {
        id: rowContent
        anchors { left: parent.left; right: parent.right; verticalCenter: parent.verticalCenter; leftMargin: Theme.s(36); rightMargin: Theme.s(14) }
        spacing: Theme.s(6)

        // The name in bold, its context as a value on the right (#193).
        Item {
          id: rowHead
          width: parent.width
          height: rowName.implicitHeight
          Label {
            id: rowName
            width: Math.min(implicitWidth, parent.width - (rowContext.visible ? rowContext.implicitWidth + Theme.s(12) : 0) - row.hideSpace)
            text: row.modelData.name
            font.weight: Font.DemiBold
            elide: Text.ElideMiddle
          }
          Label {
            id: rowContext
            visible: text !== ""
            anchors { right: parent.right; rightMargin: row.hideSpace; baseline: rowName.baseline }
            text: SessionLogic.contextText(view.app.sessions.usage, row.modelData, Theme.lang)
            color: Theme.muted
            font.pixelSize: Theme.fCaption
            font.features: { "tnum": 1 }
          }
        }
        // "Codex arbeitet" as a sentence: every card says whose session it is.
        Row {
          width: parent.width
          spacing: Theme.s(8)
          Label {
            id: rowState
            width: Math.min(implicitWidth, parent.width - (rowBehind.visible ? rowBehind.implicitWidth + parent.spacing : 0))
            text: view.app.sessions.stateText(row.modelData)
            color: row.needs || row.modelData.error ? Theme.urgent : Theme.muted
            elide: Text.ElideRight
          }
          // No window to go to: Claude's background service, or the terminal is closed.
          Label {
            id: rowBehind
            visible: row.behind
            text: Theme.t("sessions.background")
            color: Theme.aside
          }
        }
        Label {
          visible: text !== ""
          width: parent.width
          text: SessionLogic.rowDetail(row.modelData, view.app.now, Theme.lang)
          wrapMode: Text.WrapAtWordBoundaryOrAnywhere
          maximumLineCount: 2
          elide: Text.ElideRight
          color: row.needs ? Util.alpha(Theme.fg, 0.85) : Theme.muted
          font.pixelSize: Theme.fCaption
        }
        // What it does right now.
        Marquee {
          visible: row.st === "working"
          width: parent.width
          text: SessionLogic.workText(row.modelData, view.app.now, Theme.lang)
          color: Theme.accentText
          paused: view.app.paused
        }
        // One block per open request (subagents can ask at once).
        Repeater {
          model: row.needs ? row.modelData.requests : []

          Column {
            required property var modelData
            required property int index
            readonly property var ask: ({ key: row.modelData.id + "/" + modelData.id,
                                          session: row.modelData, request: modelData })
            visible: modelData.until > view.app.now
            width: rowContent.width
            topPadding: index > 0 ? Theme.s(8) : 0
            spacing: Theme.s(6)
            AskBody { app: view.app; width: parent.width; ask: parent.ask; lines: 2; showAgent: true; keys: "list" }
            Countdown { app: view.app; width: parent.width; ask: parent.ask }
            RequestButtons { app: view.app; session: row.modelData; request: parent.ask.request; focusButton: false; keys: "list" }
          }
        }
        Label {
          visible: row.needs && !view.app.sessions.liveRequests(row.modelData).length
          text: Theme.t("sessions.terminal")
          color: Theme.accentText
          font.pixelSize: Theme.fCaption
          font.weight: Font.DemiBold
        }
        // Only while a request waits: then the card itself does not jump there.
        RequestButtons {
          app: view.app
          session: row.modelData
          request: null
          keys: "list"
          visible: row.focusable && !row.behind && row.asking
        }
        // A forgotten session ends here, after one question.
        ActionButton {
          visible: view.app.sessions.canEnd(row.modelData) && !row.ending
          label: Theme.t("sessions.end")
          onClicked: { view.app.sessions.endingKey = row.modelData.id; view.app.touch() }
        }
        Label {
          visible: row.ending
          width: parent.width
          text: SessionLogic.endQuestion(row.modelData, view.app.now, Theme.lang)
          wrapMode: Text.WordWrap
          font.pixelSize: Theme.fCaption
        }
        Row {
          visible: row.ending
          spacing: Theme.s(6)
          ActionButton { label: Theme.t("sessions.endNow"); strong: true; onClicked: view.app.sessions.endSession(row.modelData) }
          ActionButton { label: Theme.t("cancel"); onClicked: { view.app.sessions.endingKey = ""; view.app.touch() } }
        }
      }
      Link {
        id: hideRow
        visible: !row.asking
        anchors.right: parent.right
        anchors.rightMargin: Theme.s(14)
        y: rowContent.y + rowHead.y + (rowHead.height - height) / 2
        text: "󰅖"
        name: Theme.t("a11y.hide")
        key: "hide|" + row.modelData.id
        font.pixelSize: Theme.fBody
        reach: Theme.s(8)
        onActivated: view.app.sessions.hide(row.modelData)
      }
    }
  }
  ActionButton {
    visible: !view.forYou && view.app.sessions.foldedCount > 0
    x: Theme.s(4)
    label: view.app.sessions.unfolded ? Theme.t("more.less") : Theme.t("sessions.more", view.app.sessions.foldedCount)
    onClicked: { view.app.sessions.unfolded = !view.app.sessions.unfolded; view.app.touch() }
  }
}
