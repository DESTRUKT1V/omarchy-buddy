import QtQuick
import "../theme"
import "../components"
import "../SettingsLogic.js" as SettingsLogic

// Click on the island: greeting, the gear and the Ruhemodus switch, then
// "Für dich" (what the user can act on now, #175), the other sessions,
// notifications and news; the list scrolls when long. The gear swaps the
// lists for the settings page. Escape or a click elsewhere closes it.
Column {
  id: view
  required property var app
  property bool shown: false
  visible: opacity > 0
  opacity: shown ? 1 : 0
  scale: shown || Theme.reduceMotion ? 1 : 0.97
  Behavior on opacity { SequentialAnimation { PauseAnimation { duration: view.shown ? 160 : 0 } NumberAnimation { duration: view.shown ? 300 : 160; easing.type: Easing.OutCubic } } }
  Behavior on scale { NumberAnimation { duration: 300; easing.type: Easing.OutCubic } }
  width: Theme.openWidth
  spacing: Theme.s(14)
  readonly property var forYou: app.forYou
  readonly property bool toDo: forYou.notes.length > 0 || forYou.news.length > 0
  // Also while "alle erledigt" can be undone, for its "Rückgängig".
  readonly property bool hasForYou: app.sessions.needsCount > 0 || toDo || app.doneBefore !== null
  // Open again at the top, where what needs the user is; a long session list folds again.
  onShownChanged: if (shown) { list.contentY = 0; app.sessions.unfolded = false }

  Item {
    visible: !view.app.settingsShown
    width: parent.width
    height: Math.max(header.implicitHeight, quietSwitch.implicitHeight)
    Row {
      id: header
      spacing: Theme.s(14)
      OMorchy { paused: view.app.paused; px: Theme.morchyPx(4); mood: view.app.mood === "sleep" ? "idle" : view.app.mood; emote: view.app.emote }
      Column {
        anchors.verticalCenter: parent.verticalCenter
        spacing: Theme.s(3)
        Label { text: view.app.greeting; font.pixelSize: Theme.fHeading; font.weight: Font.Bold }
        Label {
          text: view.app.summary
          color: Theme.muted
          width: Math.min(implicitWidth, Theme.openWidth - 17 * Theme.morchyPx(4) - Theme.s(28) - quietSwitch.width)
          wrapMode: Text.Wrap
          maximumLineCount: 2
          elide: Text.ElideRight
        }
      }
    }
    // Ruhemodus: only Claude and critical notifications pop up.
    Column {
      id: quietSwitch
      anchors.right: parent.right
      anchors.verticalCenter: parent.verticalCenter
      spacing: Theme.s(4)
      Row {
        anchors.right: parent.right
        spacing: Theme.s(6)
        ActionButton {
          anchors.verticalCenter: parent.verticalCenter
          label: "󰒓"
          name: Theme.t("settings.title")
          onClicked: view.app.settingsShown = true
        }
        Label {
          anchors.verticalCenter: parent.verticalCenter
          leftPadding: Theme.s(6)
          text: Theme.t("quiet")
        }
        Toggle {
          anchors.verticalCenter: parent.verticalCenter
          name: Theme.t("quiet")
          checked: view.app.prefs.quiet
          onToggled: function(on) { view.app.prefs.setQuiet(on) }
        }
      }
      Label {
        readonly property string note: SettingsLogic.sharingNote(view.app.settings.values, view.app.sharing, Theme.lang)
        visible: note !== "" && !view.app.prefs.quiet
        anchors.right: parent.right
        text: note
        font.pixelSize: Theme.fCaption
        color: Theme.muted
      }
    }
  }

  Flickable {
    id: list
    visible: !view.app.settingsShown
    width: parent.width
    height: Math.min(listColumn.implicitHeight, Theme.listMaxHeight)
    contentHeight: listColumn.implicitHeight
    interactive: contentHeight > height
    boundsBehavior: Flickable.StopAtBounds
    clip: true

    Column {
      id: listColumn
      width: parent.width
      spacing: Theme.s(8)

      // Each entry once: in the block or below it. Nothing for the user, no block.
      Column {
        visible: view.hasForYou
        width: parent.width
        spacing: Theme.s(8)
        // "alle erledigt" (#283) while there is something to take out, then "Rückgängig".
        SectionTitle {
          readonly property string probeOwner: "forYou"  // its link acts on the whole block (Probe.ownerOf)
          readonly property bool undo: view.app.doneBefore !== null
          text: Theme.t("forYou.title")
          link: undo ? Theme.t("notes.undo") : view.toDo ? Theme.t("forYou.allDone") : ""
          linkName: undo ? link : Theme.t("a11y.allDone")
          onLinkClicked: undo ? view.app.undoAllDone() : view.app.markAllDone()
        }
        SessionList { app: view.app; width: parent.width; forYou: true }
        NoteHistory { app: view.app; width: parent.width; forYou: true; groups: view.forYou.notes }
        NewsList { app: view.app; width: parent.width; forYou: true; items: view.forYou.news }
      }
      SessionList { id: otherSessions; app: view.app; width: parent.width; gap: view.hasForYou }
      NoteHistory {
        app: view.app; width: parent.width; groups: view.forYou.otherNotes
        gap: view.hasForYou || view.app.sessions.shownCount > 0 || otherSessions.empty
      }
      NewsList {
        app: view.app; width: parent.width; items: view.forYou.otherNews
        gap: view.hasForYou || view.app.sessions.shownCount > 0 || otherSessions.empty || view.app.notifications.groups.length > 0
      }
    }
  }
  ScrollFade { flick: list }

  SettingsView { visible: view.app.settingsShown; app: view.app; width: parent.width }
}
