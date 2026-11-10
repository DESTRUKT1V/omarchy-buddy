import QtQuick
import qs.Commons
import "../theme"
import "../components"
import "../NoteLogic.js" as NoteLogic

// The open view's notification history: one row per app and sender. A click
// on a cut-off text unfolds it, anywhere else on the row opens the app.
// Deleting can be undone for a few seconds (the link turns into "Rückgängig").
Column {
  id: view
  required property var app
  // The "Für dich" block's part (no title) or the history below it
  // (IslandLogic.forYou); hidden there while all of it is in the block.
  property bool forYou: false
  property var groups: []
  property bool gap: false  // something above the title
  readonly property bool empty: view.app.notifications.groups.length === 0
  property var unfolded: ({})  // group → true
  visible: forYou ? groups.length > 0 : groups.length > 0 || empty || view.app.notifications.canUndo
  spacing: Theme.s(8)

  function toggle(group) {
    var next = {}
    for (var g in unfolded) next[g] = true
    if (next[group]) delete next[group]
    else next[group] = true
    unfolded = next
  }

  SectionTitle {
    readonly property string probeOwner: "history"  // its link acts on the whole history (Probe.ownerOf)
    visible: !view.forYou
    text: Theme.t("notes.title")
    link: view.app.notifications.canUndo ? Theme.t("notes.undo") : view.empty ? "" : Theme.t("notes.clear")
    topPadding: view.gap ? Theme.s(6) : 0
    onLinkClicked: view.app.notifications.canUndo ? view.app.notifications.undoRemove() : view.app.notifications.clearNotes()
  }
  Label {
    visible: view.empty && !view.forYou
    x: Theme.s(4)
    text: Theme.t("notes.empty")
    color: Theme.muted
    font.pixelSize: Theme.fCaption
  }
  Item {
    visible: view.groups.length > 0
    width: view.width
    height: noteList.implicitHeight + Theme.s(8)

    Column {
      id: noteList
      x: Theme.s(4); y: Theme.s(4)
      width: parent.width - Theme.s(8)

      Repeater {
        model: view.groups

        Rectangle {
          id: noteRow
          required property var modelData
          readonly property var note: modelData.note
          readonly property bool critical: note.urgency === 2
          readonly property bool unfolded: view.unfolded[modelData.group] === true
          // Where a click unfolds: the text, or the title line that holds it
          // when there is no title (unfolded, the whole text shows below it).
          readonly property var textLabel: note.summary || unfolded ? bodyLabel : titleLabel
          width: noteList.width
          height: noteContent.implicitHeight + Theme.s(18)
          radius: Theme.radius
          // Flat (#193, B7): unread shows in the title's weight, the pointer as a surface.
          color: noteMouse.containsMouse ? Util.alpha(Theme.fg, 0.06) : "transparent"

          Click {
            id: noteMouse
            anchors.fill: parent
            ringRadius: noteRow.radius
            name: NoteLogic.noteName(noteRow.note, Theme.lang) + (noteRow.modelData.unread ? ", " + Theme.t("a11y.unread") : "")
            key: "note|" + noteRow.modelData.group
            onActivated: { view.app.notifications.activateNote(noteRow.note); view.app.opened = false }
          }
          Row {
            id: noteContent
            anchors { left: parent.left; right: parent.right; verticalCenter: parent.verticalCenter; leftMargin: Theme.s(10); rightMargin: Theme.s(10) }
            spacing: Theme.s(12)

            // App icon, or the cover/avatar when there is one.
            Item {
              width: Theme.s(34); height: Theme.s(34)
              Thumbnail { id: rowThumb; anchors.centerIn: parent; source: noteRow.note.image || ""; size: parent.width }
              Rectangle {
                visible: !rowThumb.visible
                anchors.fill: parent
                radius: Theme.radius
                color: Util.alpha(Theme.fg, 0.06)
                AppIcon { id: rowIcon; anchors.centerIn: parent; source: noteRow.note.icon || ""; size: Theme.s(20) }
                Rectangle {
                  visible: !rowIcon.visible
                  anchors.centerIn: parent
                  width: Theme.s(8); height: width; radius: width / 2
                  color: noteRow.critical ? Theme.urgent : Theme.accent
                }
              }
              KindMark { kind: noteRow.note.kind || ""; anchors { right: parent.right; bottom: parent.bottom; margins: -Theme.s(4) } }
            }
            Column {
              width: parent.width - Theme.s(46)
              spacing: Theme.s(2)
              // The sender as its own line, the time on the right (#193, B6: no "Lea Sommer · 17:14").
              Item {
                width: parent.width
                height: Math.max(noteSender.implicitHeight, removeNote.implicitHeight)
                Label {
                  id: noteSender
                  anchors.verticalCenter: parent.verticalCenter
                  width: Math.min(implicitWidth, noteMeta.x - Theme.s(12))
                  text: NoteLogic.senderOf(noteRow.note)
                  elide: Text.ElideRight
                  font.pixelSize: Theme.fCaption
                  color: noteRow.critical ? Theme.urgent : Theme.muted
                }
                Label {
                  id: noteMeta
                  anchors { right: removeNote.left; rightMargin: Theme.s(12); verticalCenter: parent.verticalCenter }
                  text: view.app.when(noteRow.note.time)
                  font.pixelSize: Theme.fCaption
                  font.features: { "tnum": 1 }
                  color: Theme.muted
                }
                Link {
                  id: removeNote
                  anchors { right: parent.right; verticalCenter: parent.verticalCenter }
                  text: "󰅖"
                  name: Theme.t("a11y.remove", NoteLogic.titleOf(noteRow.note))
                  key: "remove|" + noteRow.modelData.group
                  font.pixelSize: Theme.fBody
                  reach: Theme.s(10)
                  onActivated: view.app.notifications.removeGroup(noteRow.modelData.group)
                }
              }
              Row {
                width: parent.width
                spacing: Theme.s(6)
                Label {
                  id: titleLabel
                  text: NoteLogic.titleOf(noteRow.note)
                  font.weight: noteRow.modelData.unread ? Font.DemiBold : Font.Normal
                  elide: Text.ElideRight
                  width: Math.min(implicitWidth, parent.width - (noteBadge.visible ? noteBadge.width + parent.spacing : 0))
                  // On the message text a click unfolds and folds instead of opening the app.
                  Click {
                    anchors.fill: parent
                    enabled: noteRow.textLabel === parent && (noteRow.unfolded || parent.truncated)
                    name: noteRow.unfolded ? Theme.t("a11y.fold") : Theme.t("a11y.unfold")
                    onActivated: view.toggle(noteRow.modelData.group)
                  }
                }
                Badge { id: noteBadge; count: noteRow.modelData.count; visible: count > 1; anchors.verticalCenter: parent.verticalCenter }
              }
              Label {
                id: bodyLabel
                visible: text !== ""
                width: parent.width
                text: NoteLogic.textOf(noteRow.note) || (noteRow.unfolded ? noteRow.note.body || "" : "")
                wrapMode: Text.WrapAtWordBoundaryOrAnywhere
                maximumLineCount: noteRow.unfolded ? 999 : 2
                elide: Text.ElideRight
                color: Theme.muted
                font.pixelSize: Theme.fCaption
                Click {
                  anchors.fill: parent
                  enabled: noteRow.textLabel === parent && (noteRow.unfolded || parent.truncated)
                  name: noteRow.unfolded ? Theme.t("a11y.fold") : Theme.t("a11y.unfold")
                  onActivated: view.toggle(noteRow.modelData.group)
                }
              }
              NoteButtons { app: view.app; width: parent.width; item: noteRow.note; keys: "history"; topPadding: Theme.s(6) }
            }
          }
        }
      }
    }
  }
}
