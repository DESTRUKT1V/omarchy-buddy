import QtQuick
import "../theme"
import "../NoteLogic.js" as NoteLogic

// The mark at the bottom right of an app icon for a message from a person
// (NoteLogic.messageKind): a speech bubble for chats, a letter for mail, a
// calendar for an event reminder,
// in the island's text colour on a plate of its background, so it stands
// out from any icon in light and dark themes (at least 6.7:1 in Omarchy's).
Rectangle {
  id: mark
  property string kind: ""
  property int size: Theme.s(18)
  property string name: NoteLogic.kindName(kind, Theme.lang)
  property color ink: Theme.fg
  visible: kind !== ""
  width: size; height: size
  radius: Theme.radius
  color: Theme.bg
  Accessible.role: Accessible.StaticText
  Accessible.name: name

  Label {
    anchors.centerIn: parent
    // Nerd Font, Material Design: md-message, md-email, md-calendar.
    text: mark.kind === "mail" ? "󰇮" : mark.kind === "event" ? "󰃭" : "󰍡"
    font.pixelSize: Math.round(mark.size * 0.8)
    color: mark.ink
    Accessible.ignored: true
  }
}
