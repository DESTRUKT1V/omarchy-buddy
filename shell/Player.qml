import QtQuick
import Quickshell
import Quickshell.Services.Mpris
import "PlayerLogic.js" as PlayerLogic

// The music player the window beside the open view shows (#120): any MPRIS
// player with a track loaded, the one playing or the one that played last
// (PlayerLogic.pick). Its position only moves when asked, so it is asked
// every half second while it plays and the window shows.
Scope {
  id: media
  required property var app
  property bool shown: false  // the window is on screen: the position ticks
  property var stamps: ({})    // dbusName → ms of its last start or stop

  readonly property var current: {
    var list = Mpris.players.values
    var brief = []
    for (var i = 0; i < list.length; i++) {
      var p = list[i]
      brief.push({ id: String(p.dbusName), title: String(p.trackTitle || ""),
                   state: p.playbackState === MprisPlaybackState.Playing ? "playing"
                     : p.playbackState === MprisPlaybackState.Paused ? "paused" : "stopped" })
    }
    var id = PlayerLogic.pick(brief, stamps)
    for (i = 0; i < list.length; i++) if (String(list[i].dbusName) === id) return list[i]
    return null
  }

  Instantiator {
    model: Mpris.players
    delegate: Connections {
      required property var modelData
      target: modelData
      Component.onCompleted: media.stamp(modelData)
      function onPlaybackStateChanged() { media.stamp(modelData) }
    }
  }
  function stamp(p) {
    var next = Object.assign({}, stamps)
    next[String(p.dbusName)] = Date.now()
    stamps = next
  }

  // A new song (PlayerLogic.sings) from a music service (PlayerLogic.isMusic,
  // #188): O-Morchy sings. What plays in the first seconds after the start
  // is no change.
  readonly property string song: current && current.isPlaying && PlayerLogic.isMusic(current) ? String(current.dbusName) + "/" + current.uniqueId : ""
  property var lastSong: null
  onSongChanged: {
    if (PlayerLogic.sings(lastSong, song, app.paused)) app.feel("sing")
    if (song) lastSong = song
  }
  Timer { interval: 3000; running: true; onTriggered: if (media.lastSong === null) media.lastSong = "" }

  Timer {
    interval: 500
    repeat: true
    running: media.shown && !!media.current && media.current.isPlaying && !media.app.paused
    onTriggered: media.current.positionChanged()
  }
}
