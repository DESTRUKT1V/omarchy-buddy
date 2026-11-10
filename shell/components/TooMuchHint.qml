import QtQuick
import "../theme"

// Under a text field for a few seconds after a paste over the limit (#260):
// `paste` is the field's Paste. Read out when it appears.
Label {
  property Item paste
  visible: paste.tooMuch
  text: Theme.t("paste.tooMuch")
  color: Theme.urgent
  font.pixelSize: Theme.fCaption
  wrapMode: Text.WordWrap
  Accessible.role: Accessible.AlertMessage
  Accessible.name: text
  onVisibleChanged: if (visible) Accessible.announce(text)
}
