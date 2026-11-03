pragma Singleton

import QtQuick
import Quickshell
import qs.Commons
import qs.Commons as Commons
import "../IslandLogic.js" as IslandLogic
import "../Strings.js" as Strings
import "../SettingsLogic.js" as SettingsLogic

// Measures, fonts and colours of the island, for every file of the plugin
// (import "theme", or "../theme" from a subfolder).
//
// Look (#182): an Omarchy pop-up. Its surface, text colour, edge, corner
// radius (Hyprland's rounding, also inside: buttons, switches, rows) and
// font come from Omarchy's theme (qs.Commons), so a theme change takes the
// island along; secondary text is muted rather than smaller, buttons have
// one light primary. Every measure goes through s(), so the whole island
// follows the zoom.
Singleton {
  id: theme

  // The screen the island sits on; its pixel density sets the zoom.
  property var screen: Quickshell.screens[0]
  // "zoom" from config.json (0: automatic) and "Weniger Bewegung", set by Settings.
  property real zoomSetting: 0
  property bool reduceMotion: false
  readonly property real autoZoom: screen ? IslandLogic.autoZoom(screen.physicalPixelDensity, screen.devicePixelRatio) : 1
  readonly property real zoom: IslandLogic.zoom(zoomSetting, autoZoom)
  function s(v) { return Math.round(v * zoom) }
  // O-Morchy is pixel art: whole screen pixels per O-Morchy pixel; a half
  // size (the pill's 2.5) in half steps (OMorchy rounds each edge).
  function morchyPx(v) { var k = v % 1 ? 2 : 1; return Math.max(1, Math.round(v * zoom * k) / k) }

  // The language of every text (Strings.js), set by Buddy.qml. Every
  // binding that makes text passes it on (t() here, the *Logic.js functions
  // as their last argument), so it follows a change.
  property string lang: "de"
  function t(key, a, b, c) { return Strings.tr(lang, key, [a, b, c].filter(function(x) { return x !== undefined })) }

  readonly property int pad: s(14)
  readonly property int openWidth: s(540)
  // With the weather under the player (#184) the window beside is taller:
  // the island may grow with it, the list too.
  property bool tall: false
  readonly property int listMaxHeight: s(tall ? 660 : 560)
  readonly property int fCaption: s(11)
  readonly property int fBody: s(13)
  readonly property int fTitle: s(15)
  readonly property int fHeading: s(19)
  readonly property int radius: Style.cornerRadius
  // A focus ring around something with that radius (square stays square).
  function ring(r) { return r > 0 ? r + s(3) : 0 }
  // Omarchy's font, or the one picked in the settings ("font" in
  // config.json, set by Settings) while it is installed. Commands stay monospace.
  property string fontSetting: ""
  readonly property string fontFamily: SettingsLogic.fontFamily(fontSetting, Qt.fontFamilies(), Style.font.family)
  // tests/gallery: the island alone in another theme's colours, in memory
  // only (Probe.testColors); null: the shell's theme.
  property var testColors: null
  readonly property color fg: testColors ? testColors.foreground : Commons.Color.popups.text
  readonly property color bg: testColors ? testColors.background : Commons.Color.popups.background
  readonly property color accent: testColors ? testColors.accent : Commons.Color.accent
  // Light themes need stronger secondary text and cards; text colours reach
  // 4.5:1 in every theme (IslandLogic.shades, IslandLogic.inks). Red is
  // only ever red text or a red mark, so it is the readable one throughout;
  // the accent stays the theme's (O-Morchy, dots) and accentText is for text.
  readonly property bool light: IslandLogic.isLight(bg.r, bg.g, bg.b)
  readonly property var shades: IslandLogic.shades(light)
  readonly property var inks: IslandLogic.inks(fg, bg, accent, testColors ? testColors.urgent : Commons.Color.urgent, light)
  function rgb(c) { return Qt.rgba(c.r, c.g, c.b, 1) }
  readonly property color urgent: rgb(inks.urgent)
  readonly property color accentText: rgb(inks.accent)
  readonly property color good: rgb(inks.good)
  readonly property color aside: rgb(inks.aside)
  readonly property color muted: rgb(inks.muted)
  readonly property color spotify: rgb(inks.spotify)
  // The pop-up's edge (red while something is wrong or waits for the user).
  function edge(alarm) {
    var w = Math.max(1, Style.space(2))
    return alarm ? Border.flat(urgent, w) : testColors ? Border.flat(testColors.accent, w)
      : Border.surfaceSpec("popups", "border", Commons.Color.popups.border, w)
  }

  // Keyboard focus across a rebuilt list (a Repeater makes its rows anew
  // whenever state.json changes): Click registers targets by `key`; the
  // focused one, destroyed, hands the focus to its successor with that key.
  property var clicks: ({})
  property string lostKey: ""
  function refocus() {
    var c = clicks[lostKey]
    lostKey = ""
    if (c) c.forceActiveFocus()
  }

  function levelColor(level) {
    return level === "error" ? urgent : level === "warn" ? accentText : level === "good" ? good : muted
  }
}
