import QtQuick
import Quickshell
import Quickshell.Wayland
import qs.Commons
import "buddy/theme"
import "buddy/components"

// tests/emotes: O-Morchy's emotions (#177) side by side in real size, each
// playing for 3 s every 4 s (like Buddy.feel). Run by tests/emotes in a
// temporary Quickshell folder ("buddy" links to shell/, "Commons" to Omarchy's).
ShellRoot {
  id: root
  property bool playing: false
  readonly property var sizes: [
    { title: "Pille (2,5)", px: Theme.morchyPx(2.5), pill: true },
    { title: "Pop-up (4)", px: Theme.morchyPx(4), pill: false },
    { title: "Weniger Bewegung", px: Theme.morchyPx(2.5), pill: true, still: true }
  ]
  readonly property var emotes: [
    { mood: "thinking", emote: "", name: "Denken", why: "Solange ein Agent arbeitet (Pille, Peek, große Ansicht)." },
    { mood: "needs", emote: "ask", name: "Meldet sich", why: "Eine Agent-Anfrage kommt an, danach „braucht dich“." },
    { mood: "idle", emote: "outage", name: "Ausfall", why: "Uptime-Kuma-Dienst aus oder ein Programm abgestürzt." },
    { mood: "idle", emote: "relief", name: "Erleichtert", why: "Uptime-Kuma-Dienst wieder da." },
    { mood: "idle", emote: "alarm", name: "Wecker", why: "Terminerinnerung." },
    { mood: "idle", emote: "done", name: "Nicken + Haken", why: "Langer Terminal-Befehl fertig." },
    { mood: "idle", emote: "failed", name: "Betrübt", why: "Langer Terminal-Befehl fehlgeschlagen." },
    { mood: "idle", emote: "mail", name: "Brief", why: "Mail eines Menschen, nur im Pop-up." },
    { mood: "idle", emote: "chat", name: "Sprechblase", why: "Chatnachricht eines Menschen, nur im Pop-up." },
    { mood: "idle", emote: "sing", name: "Singt", why: "Ein neues Lied startet (Leiste, große Ansicht, Musik-Pop-up)." }
  ]

  // 1 s rest, 3 s emote, as in the island (Buddy.playEmote(name, 3000)).
  Timer {
    running: true; repeat: true; interval: root.playing ? 3000 : 1000
    onTriggered: { root.playing = !root.playing; if (root.playing) console.log("PLAY " + Date.now()) }
  }

  PanelWindow {
    id: win
    anchors.top: true
    margins.top: 40
    exclusionMode: ExclusionMode.Ignore
    WlrLayershell.layer: WlrLayer.Overlay
    WlrLayershell.keyboardFocus: WlrKeyboardFocus.None
    WlrLayershell.namespace: "omarchy-buddy-emotes"
    color: "transparent"
    implicitWidth: panel.width
    implicitHeight: panel.height

    Rectangle {
      id: panel
      width: grid.width + Theme.pad * 2
      height: grid.height + Theme.pad * 2
      radius: Theme.s(24)
      color: Qt.tint(Theme.bg, Util.alpha(Theme.fg, 0.08))  // a little lighter, so the pills stand out as on a wallpaper
      border.width: 1
      border.color: Util.alpha(Theme.fg, 0.09)

      Component.onCompleted: Qt.callLater(function() { console.log("WIN " + Math.round(panel.width) + " " + Math.round(panel.height)) })

      Column {
        id: grid
        x: Theme.pad; y: Theme.pad
        spacing: Theme.s(6)

        Row {
          spacing: Theme.s(16)
          Text { width: Theme.s(300); text: "O-Morchy, Karte #177"; color: Theme.fg; font.pixelSize: Theme.fTitle; font.family: Theme.fontFamily; font.weight: Font.DemiBold }
          Repeater {
            model: root.sizes
            Text { width: Theme.s(130); text: modelData.title; color: Theme.muted; font.pixelSize: Theme.fCaption; font.family: Theme.fontFamily }
          }
        }

        Repeater {
          model: root.emotes
          Row {
            id: row
            required property var modelData
            readonly property var e: modelData
            spacing: Theme.s(16)
            Component.onCompleted: Qt.callLater(function() {
              var p = row.mapToItem(null, 0, 0)
              console.log("ROW " + (row.e.emote || row.e.mood) + " " + Math.round(p.x) + " " + Math.round(p.y) + " " + Math.round(row.width) + " " + Math.round(row.height))
            })
            Column {
              width: Theme.s(300)
              anchors.verticalCenter: parent.verticalCenter
              Text { text: row.e.name + "  (" + (row.e.emote || row.e.mood) + ")"; color: Theme.fg; font.pixelSize: Theme.fBody; font.family: Theme.fontFamily; font.weight: Font.DemiBold }
              Text { width: parent.width; text: row.e.why; wrapMode: Text.Wrap; color: Theme.muted; font.pixelSize: Theme.fCaption; font.family: Theme.fontFamily }
            }
            Repeater {
              model: root.sizes
              Item {
                width: Theme.s(130)
                height: 15 * Theme.morchyPx(4)
                // As in the island: the pill is O-Morchy plus s(10) high, a hairline round it.
                Rectangle {
                  visible: modelData.pill
                  anchors.centerIn: parent
                  width: morchy.width + Theme.s(18)
                  height: morchy.height + Theme.s(10)
                  radius: height / 2
                  color: Theme.bg
                  border.width: 1
                  border.color: Util.alpha(Theme.fg, 0.09)
                }
                OMorchy {
                  id: morchy
                  anchors.centerIn: parent
                  px: modelData.px
                  still: modelData.still === true
                  mood: row.e.mood
                  emote: root.playing ? row.e.emote : ""
                }
              }
            }
          }
        }
      }
    }
  }
}
