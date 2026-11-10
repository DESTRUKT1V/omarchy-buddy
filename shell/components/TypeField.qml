import QtQuick
import "../theme"

// A one-paragraph text field for Claude or a notification's reply: Enter or
// "Schicken" sends, Escape or "Abbrechen" closes. Up to five lines, then it
// scrolls. Takes the keys as soon as it shows (the island asks for keyboard
// focus while Sessions.typingKey or Notifications.replyKey is set).
Column {
  id: field
  property string hint: ""
  signal accepted(string text)
  signal cancelled()
  spacing: Theme.s(6)

  function send() { if (input.text.trim() !== "") field.accepted(input.text) }
  // Opened inside a scrolling view (an own answer below long questions):
  // scroll the field and its buttons into sight.
  function reveal() {
    if (field.parent.forceLayout) field.parent.forceLayout()
    for (var p = field.parent; p; p = p.parent) {
      if (!(p instanceof Flickable)) continue
      var bottom = field.mapToItem(p.contentItem, 0, field.height).y
      if (bottom > p.contentY + p.height) p.contentY = bottom - p.height
      return
    }
  }
  onVisibleChanged: if (visible) Qt.callLater(reveal)
  onHeightChanged: if (visible) Qt.callLater(reveal)

  FontMetrics { id: metrics; font: input.font }

  ScrollBox {
    id: box
    width: parent.width
    contentHeight: input.implicitHeight
    maxHeight: Math.ceil(metrics.lineSpacing * 5)
    padX: 12
    border.width: 1
    border.color: Theme.muted

    TextInput {
      id: input
      width: parent.width
      color: Theme.fg
      font.family: Theme.fontFamily
      font.pixelSize: Theme.fBody
      wrapMode: TextInput.Wrap
      selectByMouse: true
      onVisibleChanged: if (visible) { text = ""; forceActiveFocus() }
      Component.onCompleted: if (visible) forceActiveFocus()
      onAccepted: field.send()
      Keys.onEscapePressed: field.cancelled()
      Accessible.description: paste.tooMuch ? tooMuch.text : ""
      Keys.onPressed: (event) => paste.key(event)
      Paste { id: paste }
      // Keep the line being typed in view.
      onCursorRectangleChanged: {
        var r = cursorRectangle
        if (r.y < box.flick.contentY) box.flick.contentY = r.y
        else if (r.y + r.height > box.flick.contentY + box.flick.height) box.flick.contentY = r.y + r.height - box.flick.height
      }

      Label {
        visible: input.text === ""
        width: parent.width
        elide: Text.ElideRight
        text: Theme.t("type.send", field.hint)
        color: Theme.muted
      }
    }
  }
  TooMuchHint { id: tooMuch; paste: paste; width: parent.width }
  Row {
    spacing: Theme.s(6)
    ActionButton { label: Theme.t("btn.send"); strong: true; enabled: input.text.trim() !== ""; onClicked: field.send() }
    ActionButton { label: Theme.t("cancel"); onClicked: field.cancelled() }
  }
}
