import QtQuick
import "../theme"
import "../NoteLogic.js" as NoteLogic

// A notification's own buttons (as long as its sender still listens),
// "Antworten" with a text field for apps that take inline replies, and
// "Schließen" for critical ones.
Column {
  id: noteButtons
  required property var app
  readonly property var notifications: app.notifications
  property var item: ({})
  property bool closeButton: false
  property string keys: ""   // focus keys (Click.key) in the open view, "" elsewhere
  readonly property var actions: notifications.liveActions(item)
  readonly property bool canReply: item.reply === true && notifications.live(item.key)
  readonly property bool replying: canReply && notifications.replyKey === item.key
  visible: actions.length > 0 || canReply || closeButton
  spacing: Theme.s(6)
  topPadding: Theme.s(6)

  Flow {
    visible: !noteButtons.replying
    width: parent.width
    spacing: Theme.s(6)
    ActionButton {
      visible: noteButtons.canReply
      label: Theme.t("btn.answer")
      strong: true
      onClicked: { noteButtons.notifications.replyKey = noteButtons.item.key; noteButtons.app.touch() }
    }
    Repeater {
      model: noteButtons.actions
      ActionButton {
        required property var modelData
        required property int index
        key: noteButtons.keys ? "noteButton|" + noteButtons.keys + "|" + noteButtons.item.key + "|" + index : ""
        label: NoteLogic.actionLabel(modelData.text, Theme.lang)
        strong: !noteButtons.canReply && modelData === noteButtons.actions[0]
        onClicked: noteButtons.notifications.runAction(noteButtons.item, modelData.id)
      }
    }
    ActionButton {
      visible: noteButtons.closeButton
      label: Theme.t("btn.close")
      onClicked: noteButtons.app.toasts.dismissToast()
    }
  }
  // The reply field grows to five lines, then scrolls.
  TypeField {
    visible: noteButtons.replying
    width: parent.width
    hint: noteButtons.item.replyHint || Theme.t("reply.hint")
    onAccepted: function(text) { noteButtons.notifications.sendReply(noteButtons.item, text) }
    onCancelled: noteButtons.notifications.replyKey = ""
  }
}
