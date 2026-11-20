import QtQuick
import qs.Commons
import "../theme"
import "../components"
import "../NoteLogic.js" as NoteLogic

// The open view's notification history: one row per app and sender, from
// three rows of one app on a bundle row that unfolds them (#369). A click
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
  // Which app bundles are unfolded (#369): bundle key → true. Only what the
  // view shows; it stays while the list is rebuilt (a new message), and every
  // opening of the island starts with all of them folded.
  property var open: ({})
  Connections { target: view.app; function onOpenedChanged() { if (!view.app.opened) view.open = ({}) } }
  function toggleBundle(key) {
    var next = Object.assign({}, open)
    if (next[key]) delete next[key]; else next[key] = true
    open = next
  }

  // App icon, or the cover/avatar when there is one, or without
  // an icon the sender's letter circle (#282).
  component NoteIcon: Item {
    id: icon
    property var note
    property bool critical: false
    property bool picture: true  // a bundle shows its app, not one sender's picture
    property bool mark: true
    width: Theme.s(34); height: Theme.s(34)
    // No icon at all (not one still loading: no flash when the list is rebuilt).
    readonly property bool iconless: rowIcon.status === Image.Null || rowIcon.status === Image.Error
    Thumbnail { id: rowThumb; anchors.centerIn: parent; source: icon.picture && icon.note.image || ""; size: parent.width }
    Initial {
      id: rowInitial
      visible: !rowThumb.visible && parent.iconless && text !== ""
      name: NoteLogic.senderOf(icon.note)
      size: parent.width
    }
    Rectangle {
      visible: !rowThumb.visible && !rowInitial.visible
      anchors.fill: parent
      radius: Theme.radius
      color: Util.alpha(Theme.fg, 0.06)
      AppIcon { id: rowIcon; anchors.centerIn: parent; source: icon.note.icon || ""; size: Theme.s(20) }
      Rectangle {
        visible: !rowIcon.visible
        anchors.centerIn: parent
        width: Theme.s(8); height: width; radius: width / 2
        color: icon.critical ? Theme.urgent : Theme.accent
      }
    }
    KindMark { kind: icon.mark && icon.note.kind || ""; anchors { right: parent.right; bottom: parent.bottom; margins: -Theme.s(4) } }
  }

  // An app's bundle (#369): one row for all its rows, a click unfolds them below.
  component BundleRow: Rectangle {
    id: bundle
    required property var section
    readonly property string probeOwner: "bundle"  // folding only shows (ProbeLogic.allows)
    readonly property string count: Theme.t("toast.many", section.count)
    readonly property string name: NoteLogic.bundleName(section, Theme.lang)
    height: bundleContent.implicitHeight + Theme.s(18)
    radius: Theme.radius
    color: bundleMouse.containsMouse ? Util.alpha(Theme.fg, 0.06) : "transparent"

    Click {
      id: bundleMouse
      anchors.fill: parent
      ringRadius: bundle.radius
      name: bundle.name
      key: "bundle|" + view.forYou + "|" + bundle.section.key
      onActivated: view.toggleBundle(bundle.section.key)
    }
    Row {
      id: bundleContent
      anchors { left: parent.left; right: parent.right; verticalCenter: parent.verticalCenter; leftMargin: Theme.s(10); rightMargin: Theme.s(10) }
      spacing: Theme.s(12)

      NoteIcon { note: bundle.section.note; critical: bundle.section.critical; picture: false }
      Column {
        width: parent.width - Theme.s(46)
        spacing: Theme.s(2)
        Item {
          width: parent.width
          height: Math.max(bundleSender.implicitHeight, removeBundle.implicitHeight)
          Label {
            id: bundleSender
            anchors.verticalCenter: parent.verticalCenter
            width: Math.min(implicitWidth, bundleMeta.x - Theme.s(12))
            text: bundle.section.name
            elide: Text.ElideRight
            font.pixelSize: Theme.fCaption
            color: bundle.section.critical ? Theme.urgent : Theme.muted
          }
          Label {
            id: bundleMeta
            anchors { right: removeBundle.left; rightMargin: Theme.s(12); verticalCenter: parent.verticalCenter }
            text: view.app.when(bundle.section.note.time)
            font.pixelSize: Theme.fCaption
            font.features: { "tnum": 1 }
            color: Theme.muted
          }
          Link {
            id: removeBundle
            readonly property var probeGroups: bundle.section.groups.map(function(g) { return g.group })
            anchors { right: parent.right; verticalCenter: parent.verticalCenter }
            text: "󰅖"
            name: Theme.t("a11y.remove", bundle.section.name + ", " + bundle.count)
            key: "removeBundle|" + view.forYou + "|" + bundle.section.key
            font.pixelSize: Theme.fBody
            reach: Theme.s(10)
            onActivated: view.app.notifications.removeGroups(probeGroups)
          }
        }
        Row {
          spacing: Theme.s(6)
          Label {
            text: bundle.count
            font.weight: bundle.section.unreadCount > 0 ? Font.DemiBold : Font.Normal
          }
          Label {
            anchors.verticalCenter: parent.verticalCenter
            text: bundle.section.open ? "󰅀" : "󰅂"  // md-chevron-down, md-chevron-right
            color: Theme.muted
            Accessible.ignored: true
          }
        }
        // Folded: the newest message; unfolded it is the first row below.
        Label {
          visible: !bundle.section.open
          width: parent.width
          text: NoteLogic.bundlePreview(bundle.section.note, Theme.lang)
          elide: Text.ElideRight
          color: Theme.muted
          font.pixelSize: Theme.fCaption
        }
      }
    }
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
        model: NoteLogic.bundles(view.groups, view.open)

        Column {
          id: part
          required property var modelData
          width: noteList.width

          Loader {
            active: part.modelData.bundled
            visible: active
            width: parent.width
            sourceComponent: Component { BundleRow { section: part.modelData; width: part.width } }
          }
          Repeater {
            model: part.modelData.rows

            Rectangle {
              id: noteRow
              required property var modelData
              readonly property var note: modelData.note
              readonly property bool critical: note.urgency === 2
              readonly property bool unfolded: view.unfolded[modelData.group] === true
              // Inside a bundle (#369) its row says the app: no icon and no sender
              // line, only a picture of the message's own; the kind only where they differ.
              readonly property bool sub: part.modelData.bundled
              readonly property bool pictured: !sub || !!note.image
              // Where a click unfolds: the text, or the title line that holds it
              // when there is no title (unfolded, the whole text shows below it).
              readonly property var textLabel: note.summary || unfolded ? bodyLabel : titleLabel
              readonly property real indent: part.modelData.bundled ? Theme.s(20) : 0
              x: indent
              width: noteList.width - indent
              height: noteContent.implicitHeight + Theme.s(18)
              radius: Theme.radius
              // Flat (#193, B7): unread shows in the title's weight, the pointer as a surface.
              color: noteMouse.containsMouse ? Util.alpha(Theme.fg, 0.06) : "transparent"

              Click {
                id: noteMouse
                anchors.fill: parent
                ringRadius: noteRow.radius
                name: NoteLogic.noteName(noteRow.note, Theme.lang, noteRow.sub) + (noteRow.modelData.unread ? ", " + Theme.t("a11y.unread") : "")
                key: "note|" + noteRow.modelData.group
                onActivated: { view.app.notifications.activateNote(noteRow.note); view.app.opened = false }
              }
              Row {
                id: noteContent
                anchors { left: parent.left; right: parent.right; verticalCenter: parent.verticalCenter; leftMargin: Theme.s(10); rightMargin: Theme.s(10) }
                spacing: Theme.s(12)

                NoteIcon { visible: noteRow.pictured; note: noteRow.note; critical: noteRow.critical; mark: !noteRow.sub || part.modelData.mixed }
                Column {
                  width: parent.width - (noteRow.pictured ? Theme.s(46) : 0)
                  spacing: Theme.s(2)
                  // The sender as its own line, the time on the right (#193, B6: no "Lea Sommer · 17:14").
                  // In a bundle no sender line: time and × sit beside the title.
                  Item {
                    id: head
                    width: parent.width
                    readonly property real line: Math.max(noteSender.implicitHeight, removeNote.implicitHeight)
                    readonly property real metaY: noteRow.sub ? titleRow.height / 2 : line / 2  // centre of time and ×
                    height: noteRow.sub ? titleRow.height : line + Theme.s(2) + titleRow.height
                    Label {
                      id: noteSender
                      visible: !noteRow.sub
                      y: (head.line - height) / 2
                      width: Math.min(implicitWidth, noteMeta.x - Theme.s(12))
                      text: NoteLogic.senderOf(noteRow.note)
                      elide: Text.ElideRight
                      font.pixelSize: Theme.fCaption
                      color: noteRow.critical ? Theme.urgent : Theme.muted
                    }
                    Label {
                      id: noteMeta
                      anchors { right: removeNote.left; rightMargin: Theme.s(12) }
                      y: head.metaY - height / 2
                      text: view.app.when(noteRow.note.time)
                      font.pixelSize: Theme.fCaption
                      font.features: { "tnum": 1 }
                      color: Theme.muted
                    }
                    Link {
                      id: removeNote
                      anchors.right: parent.right
                      y: head.metaY - height / 2
                      text: "󰅖"
                      name: Theme.t("a11y.remove", NoteLogic.titleOf(noteRow.note))
                      key: "remove|" + noteRow.modelData.group
                      font.pixelSize: Theme.fBody
                      reach: Theme.s(10)
                      onActivated: view.app.notifications.removeGroup(noteRow.modelData.group)
                    }
                    Row {
                      id: titleRow
                      anchors.bottom: parent.bottom
                      width: noteRow.sub ? noteMeta.x - Theme.s(12) : parent.width
                      spacing: Theme.s(6)
                      KindMark { id: kindInline; kind: noteRow.sub && !noteRow.pictured && part.modelData.mixed && noteRow.note.kind || ""; anchors.verticalCenter: parent.verticalCenter }
                      Label {
                        id: titleLabel
                        text: NoteLogic.titleOf(noteRow.note)
                        font.weight: noteRow.modelData.unread ? Font.DemiBold : Font.Normal
                        elide: Text.ElideRight
                        width: Math.min(implicitWidth, parent.width - (noteBadge.visible ? noteBadge.width + parent.spacing : 0) - (kindInline.visible ? kindInline.width + parent.spacing : 0))
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
  }
}
