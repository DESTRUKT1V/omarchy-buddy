import QtQuick
import qs.Commons
import "../theme"

// A one-line text field on the settings page (Spotify's Client ID, the
// Kuma address): round like the buttons, the placeholder while empty, the
// border thicker and in the accent colour while it has the focus. `name`:
// what screen readers call it.
Rectangle {
  id: field
  property alias text: input.text
  property string placeholder: ""
  property string name: placeholder
  signal accepted()
  signal edited()
  function focusInput() { input.forceActiveFocus() }
  radius: Theme.radius
  color: Util.alpha(Theme.fg, 0.06)
  border.width: input.activeFocus ? Theme.s(2) : 1
  border.color: input.activeFocus ? Theme.accentText : Theme.muted

  TextInput {
    id: input
    anchors.fill: parent
    anchors.leftMargin: Theme.s(14); anchors.rightMargin: Theme.s(14)
    verticalAlignment: TextInput.AlignVCenter
    color: Theme.fg
    font.family: Theme.fontFamily
    font.pixelSize: Theme.fCaption
    selectByMouse: true
    clip: true
    activeFocusOnTab: true
    Accessible.role: Accessible.EditableText
    Accessible.name: field.name
    onAccepted: field.accepted()
    onTextEdited: field.edited()
    Label {
      visible: input.text === ""
      anchors.verticalCenter: parent.verticalCenter
      width: parent.width
      text: field.placeholder
      elide: Text.ElideRight
      color: Theme.muted
      font.pixelSize: Theme.fCaption
    }
  }
}
