import QtQuick
import qs.Commons
import "../theme"

// A one-line text field on the settings page (Spotify's Client ID, the
// Kuma address): round like the buttons, the placeholder while empty, the
// border thicker and in the accent colour while it has the focus. `name`:
// what screen readers call it. `fieldHeight`: the box's; a paste over the
// limit shows a hint under it for a few seconds (#260).
Column {
  id: field
  property alias text: input.text
  property string placeholder: ""
  property string name: placeholder
  property alias fieldHeight: box.height
  signal accepted()
  signal edited()
  function focusInput() { input.forceActiveFocus() }
  spacing: Theme.s(4)

  Rectangle {
    id: box
    width: parent.width
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
      Accessible.description: paste.tooMuch ? tooMuch.text : ""
      onAccepted: field.accepted()
      onTextEdited: field.edited()
      Keys.onPressed: (event) => paste.key(event)
      Paste { id: paste }
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
  TooMuchHint { id: tooMuch; paste: paste; x: Theme.s(4); width: parent.width - Theme.s(8) }
}
