import QtQuick
import Quickshell
import Quickshell.Io
import "WeatherLogic.js" as WeatherLogic

// The weather (#184) while "Omarchy-Wetter ersetzen" is on (config.json
// "weather"): for the tile under the music player (views/WeatherView.qml)
// and the text at the bar widget. The place is Omarchy's weather.json
// (watched; without one wttr.in finds it by the IP address, as Omarchy's
// widget does); what it fetches and how it reads the answers:
// WeatherLogic.js. Every 10 minutes while the user is around, at once
// when the place changes; offline it keeps the last weather and says from when.
Scope {
  id: weather
  required property var app

  readonly property bool on: app.settings.values.weather
  property var place: null       // weather.json as Omarchy reads it (null: by the IP address)
  property var spot: null        // the place with coordinates
  property bool placeFailed: false
  property var report: null      // WeatherLogic.combine
  property bool failed: false    // the last fetch brought nothing
  property real fetched: 0
  property bool testing: false   // tests/looks sets the weather (Probe.testWeather)
  readonly property string state: WeatherLogic.tileState(report, placeFailed, failed)
  readonly property var bar: on ? WeatherLogic.barText(report, app.now, app.lang) : null
  property bool twelveHour: false  // Omarchy's bar clock shows AM/PM (the hours ahead, #191)

  // The place search in the tile (as in Omarchy's widget).
  property var found: []
  property string searchState: ""  // "", "searching", "empty", "failed", "found"

  function setPlace(text) {
    var p = WeatherLogic.parsePlace(text)
    if (JSON.stringify(p) === JSON.stringify(place)) return
    place = p
    spot = WeatherLogic.hasCoords(p) ? p : null
    placeFailed = false
    failed = false
    if (!testing) report = null  // another place: not the old one's weather
    refresh()
  }

  function refresh() {
    if (!on || testing || locator.running || fetcher.running) return
    if (!spot) {
      locator.command = ["sh", "-c", "curl -fsS --max-time 10 \"$1\" || echo offline", "sh", WeatherLogic.locateUrl(place)]
      locator.running = true
      return
    }
    fetcher.list = WeatherLogic.sources(spot, Date.now() / 1000)
    fetcher.command = WeatherLogic.fetchCommand(fetcher.list)
    fetcher.running = true
  }

  // Severe weather into the news and as a pop-up, once per warning (#189,
  // WeatherLogic.severeNews); omarchy-buddy-say skips a key already listed.
  property var told: []
  function tell() {
    var keys = told.concat(app.news.items.map(function(i) { return String(i.key || "") }))
    WeatherLogic.severeNews(report, keys, Date.now() / 1000, app.lang).forEach(function(n) {
      told = told.concat([n.key])
      Quickshell.execDetached([app.repo + "/bin/omarchy-buddy-say", "--level", n.level, "--key", n.key, n.title, n.body])
    })
  }

  function search(text) {
    if (String(text).trim() === "") return
    found = []
    searchState = "searching"
    searcher.command = ["curl", "-fsS", "--max-time", "10", WeatherLogic.searchUrl(text, app.lang)]
    searcher.running = true
  }
  function endSearch() { found = []; searchState = "" }
  // omarchy-weather-location writes weather.json; the watcher brings it here.
  function pick(p) {
    Quickshell.execDetached([app.omarchyBin + "omarchy-weather-location"].concat(WeatherLogic.setPlaceArgs(p)))
    endSearch()
  }
  function automatic() {
    Quickshell.execDetached([app.omarchyBin + "omarchy-weather-location", "--clear"])
    endSearch()
  }

  FileView {
    // Omarchy keeps it under ~/.local/state whatever XDG_STATE_HOME says (omarchy-weather-location).
    path: weather.app.home + "/.local/state/omarchy/settings/weather.json"
    watchChanges: true
    printErrors: false
    onLoaded: weather.setPlace(text())
    onLoadFailed: weather.setPlace("")
    onFileChanged: reload()
  }

  FileView {
    path: weather.app.home + "/.config/omarchy/shell.json"  // where Omarchy's shell reads it
    watchChanges: true
    printErrors: false
    onFileChanged: reload()
    onLoaded: weather.twelveHour = WeatherLogic.twelveHour(text())
    onLoadFailed: weather.twelveHour = false
  }

  Timer {
    interval: 600000
    repeat: true
    triggeredOnStart: true
    running: weather.on && !weather.app.away && !weather.testing
    // Back from away or switched on: only if the last fetch is old or failed.
    onTriggered: if (weather.failed || Date.now() / 1000 - weather.fetched > 300) weather.refresh()
  }

  Process {
    id: locator
    stdout: StdioCollector {
      onStreamFinished: {
        if (weather.testing) return
        if (text.trim() === "offline") { weather.failed = true; return }
        weather.spot = WeatherLogic.located(weather.place, text)
        weather.placeFailed = !weather.spot
        if (weather.spot) weather.refresh()
      }
    }
  }
  Process {
    id: fetcher
    property var list: []
    stdout: StdioCollector {
      onStreamFinished: {
        if (!weather.spot || weather.testing) return
        var now = Date.now() / 1000
        var d = WeatherLogic.combine(WeatherLogic.split(text, fetcher.list), weather.spot, now)
        weather.fetched = now
        weather.failed = !d
        if (d) { weather.report = d; weather.tell() }
      }
    }
  }
  Process {
    id: searcher
    onExited: (code) => { if (code !== 0) weather.searchState = "failed" }
    stdout: StdioCollector {
      onStreamFinished: {
        if (weather.searchState !== "searching") return
        weather.found = WeatherLogic.places(text)
        weather.searchState = weather.found.length ? "found" : text.trim() === "" ? "failed" : "empty"
      }
    }
  }
}
