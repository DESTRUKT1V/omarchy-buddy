import QtQuick
import "../theme"
import "../IslandLogic.js" as IslandLogic

// A sender without an icon (#282): the first letter of its name on a circle
// in a colour of its own (IslandLogic.initial, IslandLogic.initialInks);
// hidden without a name (text ""). The name beside it says who it is.
Rectangle {
  id: circle
  property string name: ""
  property int size: Theme.s(20)
  readonly property string text: IslandLogic.initial(name)
  readonly property var inks: IslandLogic.initialInks(name, Theme.fg, Theme.bg, Theme.light)
  visible: text !== ""
  width: size; height: size
  radius: size / 2
  color: Theme.rgb(inks.fill)
  Accessible.ignored: true

  Label {
    id: letter
    anchors.centerIn: parent
    text: circle.text
    color: Theme.rgb(circle.inks.ink)
    font.pixelSize: Math.round(circle.size * 0.5)
    font.weight: Font.DemiBold
  }
}
