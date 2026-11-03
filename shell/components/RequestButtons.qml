import QtQuick
import "../theme"
import "../SessionLogic.js" as SessionLogic

// The answers to one request, by its kind, plus the way to its terminal:
//   permission  Erlauben / Immer erlauben / Ablehnen
//   question    Antworten (once every question has an answer; with one
//               question and one choice the option itself answers)
//   plan        Freigeben + Auto / Freigeben / Überarbeiten … (with a text
//               field for what Claude should change)
Column {
  id: buttons
  required property var app
  property var session: ({})
  property var request: null
  property bool focusButton: true
  // Focus keys (Click.key) in the open view's list, "" elsewhere.
  property string keys: ""
  function key(what) { return keys ? keys + "|" + askKey + "|" + what : "" }
  width: parent ? parent.width : 0
  readonly property string kind: request ? request.kind : ""
  readonly property string askKey: request ? session.id + "/" + request.id : ""
  readonly property bool revising: kind === "plan" && app.sessions.typingKey === askKey + "|plan"
  spacing: Theme.s(6)

  Flow {
    visible: !buttons.revising
    width: parent.width
    spacing: Theme.s(6)

    ActionButton {
      visible: buttons.kind === "permission"
      label: Theme.t("btn.allow")
      key: buttons.key("allow")
      strong: true
      onClicked: buttons.app.sessions.decide(buttons.session, buttons.request, "allow")
    }
    ActionButton {
      visible: buttons.kind === "permission" && buttons.request.always !== ""
      label: Theme.t("btn.always")
      key: buttons.key("always")
      onClicked: buttons.app.sessions.decide(buttons.session, buttons.request, "always")
    }
    ActionButton {
      visible: buttons.kind === "permission"
      label: Theme.t("btn.deny")
      key: buttons.key("deny")
      onClicked: buttons.app.sessions.decide(buttons.session, buttons.request, "deny")
    }

    ActionButton {
      id: answerButton
      readonly property var ask: ({ key: buttons.askKey, session: buttons.session, request: buttons.request })
      visible: buttons.kind === "question" && !SessionLogic.answersAtOnce(buttons.request.questions)
      enabled: visible && SessionLogic.answersComplete(buttons.request.questions, buttons.app.sessions.answers[buttons.askKey] || {})
      label: Theme.t("btn.answer")
      key: buttons.key("answer")
      strong: true
      onClicked: buttons.app.sessions.sendAnswers(ask)
    }
    Label {
      visible: answerButton.visible && !answerButton.enabled
      height: answerButton.height
      verticalAlignment: Text.AlignVCenter
      text: buttons.kind === "question" ? SessionLogic.openText(buttons.request.questions, buttons.app.sessions.answers[buttons.askKey], Theme.lang) : ""
      color: Theme.muted
      font.pixelSize: Theme.fCaption
    }

    ActionButton {
      visible: buttons.kind === "plan"
      label: Theme.t("btn.approveAuto")
      key: buttons.key("auto")
      strong: true
      onClicked: buttons.app.sessions.decide(buttons.session, buttons.request, "auto")
    }
    ActionButton {
      visible: buttons.kind === "plan"
      label: Theme.t("btn.approve")
      key: buttons.key("approve")
      onClicked: buttons.app.sessions.decide(buttons.session, buttons.request, "allow")
    }
    ActionButton {
      visible: buttons.kind === "plan"
      label: Theme.t("btn.revise")
      key: buttons.key("revise")
      onClicked: { buttons.app.sessions.typingKey = buttons.askKey + "|plan"; buttons.app.touch() }
    }

    ActionButton {
      visible: buttons.focusButton && (!!buttons.session.window || buttons.session.orca === true)
        && !buttons.app.sessions.background(buttons.session)
      label: buttons.session.orca ? Theme.t("btn.toOrca") : Theme.t("btn.toWindow")
      key: buttons.keys ? buttons.keys + "|" + buttons.session.id + "|window" : ""
      onClicked: buttons.app.sessions.focusSession(buttons.session)
    }
  }
  TypeField {
    visible: buttons.revising
    width: parent.width
    hint: Theme.t("revise.hint")
    onAccepted: function(text) { buttons.app.sessions.revisePlan(buttons.session, buttons.request, text) }
    onCancelled: buttons.app.sessions.typingKey = ""
  }
}
