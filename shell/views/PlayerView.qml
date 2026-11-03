import QtQuick
import Quickshell.Services.Mpris
import qs.Commons
import "../theme"
import "../components"
import "../PlayerLogic.js" as PlayerLogic

// The window beside the open view while a music player has a track loaded
// (#120, after the music player of the iPhone's Dynamic Island): the cover,
// title and artist, the position (drag or arrow keys to seek, when the
// player can) and back, play/pause, next (greyed out when the player
// cannot), and Spotify's "+" (Spotify.qml): with Spotify connected it
// saves and its check removes, else the same + sends Spotify's own shortcut, which toggles. Island.qml
// places it and fades it in; this file only shows.
Column {
  id: view
  required property var app
  property var player: null
  readonly property var spotify: app.spotify
  readonly property bool seekable: !!player && player.canSeek && player.positionSupported && player.length > 0
  // While the bar is dragged, it shows where the drag is, not the player.
  property real dragAt: -1
  readonly property real at: dragAt >= 0 ? dragAt : player ? player.position : 0
  width: Theme.s(264)
  spacing: Theme.s(14)

  Thumbnail {
    id: cover
    source: view.player ? view.player.trackArtUrl || "" : ""
    size: view.width
    placeholder: true
    // Spotify's desktop app only (#199): the cover brings its window up.
    Click {
      anchors.fill: parent
      enabled: view.spotify.desktopApp
      visible: enabled
      ringRadius: cover.radius
      name: Theme.t("spotify.open")
      onActivated: view.spotify.raise()
    }
  }

  Item {
    width: parent.width
    height: Math.max(titles.implicitHeight, like.visible ? like.height : 0)
    Column {
      id: titles
      width: parent.width - (like.visible ? like.width + Theme.s(8) : 0)
      anchors.verticalCenter: parent.verticalCenter
      spacing: Theme.s(2)
      Label {
        width: parent.width
        text: view.player ? view.player.trackTitle || "" : ""
        font.pixelSize: Theme.fTitle
        font.weight: Font.DemiBold
        elide: Text.ElideRight
      }
      Label {
        width: parent.width
        text: view.player ? view.player.trackArtist || view.player.identity || "" : ""
        color: Theme.muted
        elide: Text.ElideRight
      }
    }
    // Spotify's "+" (#121): connected, or Spotify's desktop app with its window (#162).
    Rectangle {
      id: like
      readonly property string shows: view.spotify.like
      readonly property bool key: !view.spotify.connected
      // what a screen reader says, also the name tests/live clicks by
      readonly property string name: Theme.t(key ? "spotify.toggle" : shows === "saved" ? "spotify.remove" : shows === "busy" ? "spotify.busy" : "spotify.add")
      visible: shows !== ""
      anchors.right: parent.right
      anchors.verticalCenter: parent.verticalCenter
      width: Theme.s(36); height: width
      radius: Theme.radius
      color: likeMouse.containsMouse && likeMouse.enabled ? Util.alpha(Theme.fg, 0.12) : "transparent"
      opacity: shows === "busy" ? 0.45 : 1
      scale: likeMouse.pressed && !Theme.reduceMotion ? 0.9 : 1
      Behavior on scale { NumberAnimation { duration: 90 } }
      Behavior on color { ColorAnimation { duration: 120 } }
      Behavior on opacity { NumberAnimation { duration: 120 } }
      Label {
        anchors.centerIn: parent
        // check-circle, plus-circle-outline (also for the shortcut: the line under it says it toggles)
        text: like.shows === "saved" ? "\u{F05E0}" : "\u{F0419}"
        color: like.shows === "saved" ? Theme.spotify : Theme.fg
        font.pixelSize: Theme.s(26)
      }
      Click {
        id: likeMouse
        anchors.fill: parent
        anchors.margins: -Theme.s(4)
        ringRadius: Theme.ring(like.radius)
        enabled: ["add", "saved", "error", "toggle", "sent"].indexOf(like.shows) !== -1
        cursorShape: enabled ? Qt.PointingHandCursor : Qt.ArrowCursor
        name: like.name
        Accessible.description: like.shows === "saved" ? Theme.t("spotify.saved") : ""
        // The check takes the track out again (#163).
        onActivated: like.key ? view.spotify.toggle() : like.shows === "error" ? view.spotify.retry()
          : like.shows === "saved" ? view.spotify.remove() : view.spotify.save()
      }
    }
  }

  // Without a connection the island cannot see the result: what the shortcut does.
  Label {
    visible: view.spotify.like === "sent"
    width: parent.width
    text: Theme.t("spotify.sent")
    color: Theme.muted
    font.pixelSize: Theme.fCaption
    wrapMode: Text.WordWrap
  }

  // What went wrong with Spotify, and what helps.
  Item {
    readonly property var problem: PlayerLogic.likeError(view.spotify.answer ? view.spotify.answer.error : "")
    visible: view.spotify.like === "error"
    width: parent.width
    height: problemText.implicitHeight
    Label {
      id: problemText
      width: parent.width - fix.width - Theme.s(12)
      text: Theme.t(parent.problem.key)
      color: Theme.urgent
      font.pixelSize: Theme.fCaption
      wrapMode: Text.WordWrap
    }
    Link {
      id: fix
      anchors.right: parent.right
      anchors.rightMargin: Theme.s(4)
      text: Theme.t(parent.problem.fix === "reconnect" ? "spotify.reconnect" : "spotify.retry")
      onActivated: parent.problem.fix === "reconnect" ? view.spotify.connect("") : view.spotify.retry()
    }
  }

  Column {
    width: parent.width
    spacing: Theme.s(6)
    Item {
      id: bar
      width: parent.width
      height: Theme.s(14)
      activeFocusOnTab: view.seekable
      Accessible.role: Accessible.Slider
      Accessible.name: Theme.t("player.position")
      Accessible.description: Theme.t("player.positionOf", PlayerLogic.clock(view.at), PlayerLogic.clock(view.player ? view.player.length : 0))
      Keys.onLeftPressed: view.seekTo(view.at - 5)
      Keys.onRightPressed: view.seekTo(view.at + 5)

      Rectangle {
        id: track
        anchors.verticalCenter: parent.verticalCenter
        width: parent.width
        height: Theme.s(barMouse.pressed || barMouse.containsMouse ? 6 : 4)
        radius: height / 2
        color: Util.alpha(Theme.fg, 0.15)
        Rectangle {
          width: Math.round(parent.width * PlayerLogic.progress(view.at, view.player ? view.player.length : 0))
          height: parent.height
          radius: parent.radius
          color: Theme.fg
        }
      }
      Rectangle {
        visible: bar.activeFocus
        anchors.fill: parent
        anchors.margins: -Theme.s(3)
        radius: Theme.radius
        color: "transparent"
        border.width: Theme.s(2)
        border.color: Theme.accentText
      }
      MouseArea {
        id: barMouse
        anchors.fill: parent
        anchors.topMargin: -Theme.s(5); anchors.bottomMargin: -Theme.s(5)
        enabled: view.seekable
        hoverEnabled: true
        cursorShape: enabled ? Qt.PointingHandCursor : Qt.ArrowCursor
        function along(x) { return Math.max(0, Math.min(1, x / width)) * view.player.length }
        onPressed: function(m) { view.dragAt = along(m.x) }
        onPositionChanged: function(m) { if (pressed) view.dragAt = along(m.x) }
        onReleased: { view.seekTo(view.dragAt); view.dragAt = -1 }
        onCanceled: view.dragAt = -1
      }
    }
    Item {
      width: parent.width
      height: elapsed.implicitHeight
      Label { id: elapsed; text: PlayerLogic.clock(view.at); color: Theme.muted; font.pixelSize: Theme.fCaption; font.features: { "tnum": 1 } }
      Label { anchors.right: parent.right; text: PlayerLogic.clock(view.player ? view.player.length : 0); color: Theme.muted; font.pixelSize: Theme.fCaption; font.features: { "tnum": 1 } }
    }
  }

  Row {
    anchors.horizontalCenter: parent.horizontalCenter
    spacing: Theme.s(20)
    PlayerButton {
      glyph: "󰒮"
      name: Theme.t("player.prev")
      enabled: !!view.player && view.player.canGoPrevious
      onActivated: view.player.previous()
    }
    PlayerButton {
      glyph: view.player && view.player.isPlaying ? "󰏤" : "󰐊"
      name: Theme.t(view.player && view.player.isPlaying ? "player.pause" : "player.play")
      strong: true
      enabled: !!view.player && view.player.canTogglePlaying
      onActivated: view.player.togglePlaying()
    }
    PlayerButton {
      glyph: "󰒭"
      name: Theme.t("player.next")
      enabled: !!view.player && view.player.canGoNext
      onActivated: view.player.next()
    }
  }

  function seekTo(seconds) {
    if (!seekable) return
    player.position = Math.max(0, Math.min(player.length, seconds))
  }

  // A round icon button: the middle one larger and filled.
  component PlayerButton: Rectangle {
    id: button
    property string glyph: ""
    property string name: ""
    property bool strong: false
    signal activated()
    width: Theme.s(strong ? 52 : 44); height: width
    radius: Theme.radius
    anchors.verticalCenter: parent.verticalCenter
    color: strong ? (buttonMouse.containsMouse ? Util.alpha(Theme.fg, 0.85) : Theme.fg)
      : buttonMouse.containsMouse ? Util.alpha(Theme.fg, 0.12) : "transparent"
    opacity: enabled ? 1 : 0.35
    scale: buttonMouse.pressed && !Theme.reduceMotion ? 0.92 : 1
    Behavior on scale { NumberAnimation { duration: 90 } }
    Behavior on color { ColorAnimation { duration: 120 } }
    Label {
      anchors.centerIn: parent
      text: button.glyph
      color: button.strong ? Theme.bg : Theme.fg
      font.pixelSize: Theme.s(button.strong ? 26 : 24)
    }
    Click {
      id: buttonMouse
      anchors.fill: parent
      ringRadius: button.radius
      name: button.name
      onActivated: button.activated()
    }
  }
}
