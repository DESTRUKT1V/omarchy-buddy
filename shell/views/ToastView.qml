import QtQuick
import "../theme"
import "../components"
import "../IslandLogic.js" as IslandLogic
import "../NoteLogic.js" as NoteLogic
import "../PlayerLogic.js" as PlayerLogic
import "../ToastLogic.js" as ToastLogic

// A pop-up: a news item, a notification (bundled per sender) or the track
// a music player just started. "×" (or a right click) puts it away.
Row {
  id: view
  required property var app
  property bool shown: false
  readonly property var item: view.app.toasts.toast || ({})
  readonly property bool note: item.note === true
  readonly property bool media: item.media === true
  readonly property var player: media ? view.app.notifications.playerFor(item.app) : null
  readonly property string title: player && player.trackTitle ? player.trackTitle : item.title || ""
  readonly property string body: player && player.trackArtist ? player.trackArtist : item.body || ""
  // Its emotion (#177) while it plays (Buddy.feel), then rest; without one,
  // O-Morchy talks or celebrates as before.
  readonly property string feeling: ToastLogic.emoteFor(item)
  visible: opacity > 0
  opacity: shown ? 1 : 0
  scale: shown || Theme.reduceMotion ? 1 : 0.97
  Behavior on opacity { SequentialAnimation { PauseAnimation { duration: view.shown ? 140 : 0 } NumberAnimation { duration: view.shown ? 260 : 140; easing.type: Easing.OutCubic } } }
  Behavior on scale { NumberAnimation { duration: 280; easing.type: Easing.OutCubic } }
  spacing: Theme.s(14)

  OMorchy {
    paused: view.app.paused
    visible: !view.media
    px: Theme.morchyPx(4)
    mood: view.item.level === "error" ? "worried" : "idle"
    emote: view.feeling ? (view.app.emote === view.feeling ? view.feeling : "") : view.item.level === "good" ? "celebrate" : "talk"
  }
  Thumbnail {
    show: view.media
    source: view.player && view.player.trackArtUrl ? view.player.trackArtUrl : view.item.image || ""
    size: Theme.s(64)
    placeholder: true
  }
  Column {
    anchors.verticalCenter: view.media ? parent.verticalCenter : undefined
    spacing: Theme.s(4)
    // A minimum width keeps the island calm between short and long items.
    width: view.media ? Math.max(Theme.s(220), Math.min(Theme.s(320), Math.max(titleText.implicitWidth, bodyText.implicitWidth)))
      : Math.max(Theme.s(320), Math.min(Theme.s(420), Math.max(titleText.implicitWidth, bodyText.implicitWidth)))

    Item {
      width: parent.width
      height: toastHead.implicitHeight
      Row {
        id: toastHead
        spacing: Theme.s(6)
        Item {
          // Not the children's `visible`: they read false while this is hidden.
          visible: toastIcon.status === Image.Ready || toastMark.kind !== ""
          width: Theme.s(22); height: width
          anchors.verticalCenter: parent.verticalCenter
          AppIcon { id: toastIcon; source: view.note ? view.item.icon || "" : ""; size: parent.width }
          KindMark {
            id: toastMark
            kind: view.note ? view.item.kind || "" : ""
            size: Theme.s(16)
            // Without an icon the mark stands in its place.
            anchors { right: parent.right; bottom: parent.bottom; margins: toastIcon.status === Image.Ready ? -Theme.s(4) : 0 }
          }
        }
        Label {
          anchors.verticalCenter: parent.verticalCenter
          text: view.note ? (view.item.glyph ? view.item.glyph + "  " : "") + NoteLogic.senderOf(view.item)
            : IslandLogic.sourceName(view.item.source, Theme.lang)
          color: view.note && view.item.level !== "error" ? Theme.fg : Theme.levelColor(view.item.level)
          font.pixelSize: Theme.fCaption
          font.weight: Font.DemiBold
        }
        Label {
          anchors.verticalCenter: parent.verticalCenter
          text: view.app.when(view.item.time || view.app.now)
          color: Theme.muted
          font.pixelSize: Theme.fCaption
        }
        Badge { visible: view.note && view.item.count > 1; count: view.item.count || 0; anchors.verticalCenter: parent.verticalCenter }
      }
      Link {
        anchors.right: parent.right
        anchors.verticalCenter: toastHead.verticalCenter
        text: "󰅖"
        name: Theme.t("a11y.close")
        font.pixelSize: Theme.fBody
        reach: Theme.s(10)
        onActivated: view.app.toasts.dismissToast()
      }
    }
    Label {
      id: titleText
      width: parent.width
      text: view.title
      font.pixelSize: Theme.fTitle
      font.weight: Font.DemiBold
      elide: Text.ElideRight
    }
    Label {
      id: bodyText
      visible: text !== ""
      width: parent.width
      text: view.body
      color: Theme.muted
      wrapMode: Text.WrapAtWordBoundaryOrAnywhere
      maximumLineCount: view.media ? 1 : 3
      elide: Text.ElideRight
    }
    Label {
      visible: view.media && text !== ""
      width: parent.width
      text: view.player ? view.player.trackAlbum || "" : ""
      color: Theme.muted
      font.pixelSize: Theme.fCaption
      elide: Text.ElideRight
    }
    // A news item's action (IslandLogic.actionLabel).
    Column {
      visible: !view.note && toastAction.label !== ""
      topPadding: Theme.s(6)
      ActionButton {
        id: toastAction
        label: IslandLogic.actionLabel(view.item.action, Theme.lang)
        strong: true
        onClicked: { var item = view.item; if (!IslandLogic.actionKeepsToast(item.action)) view.app.toasts.dismissToast(); view.app.runAction(item) }
      }
    }
    NoteButtons {
      app: view.app
      visible: view.note && !view.media
      width: parent.width
      item: view.item
      closeButton: view.item.sticky === true
    }
  }
  Thumbnail { show: !view.media; source: view.note ? view.item.image || "" : ""; size: Theme.s(64) }
  // O-Morchy sings along to a music service (#185, #188), else bops along.
  OMorchy {
    paused: view.app.paused
    visible: view.media
    anchors.verticalCenter: parent.verticalCenter
    px: Theme.morchyPx(2)
    emote: PlayerLogic.isMusic(view.player) ? "sing" : "celebrate"
  }
}
