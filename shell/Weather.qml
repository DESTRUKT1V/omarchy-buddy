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
    if (!on || testing || locator.active || fetcher.active) return
    if (!spot) {
      start(locator, WeatherLogic.curlCommand("offline"), WeatherLogic.locateUrl(place))
      return
    }
    fetcher.list = WeatherLogic.sources(spot, Date.now() / 1000)
    start(fetcher, WeatherLogic.fetchCommand(), fetcher.list.map(function(s) { return s.url }))
  }

  // The addresses go on curl's stdin, not into its arguments (WeatherLogic.curl).
  // A search while one runs: once more afterwards, with the newest words.
  function start(helper, argv, urls) {
    helper.argv = argv
    helper.payload = WeatherLogic.curlInput(urls)
    helper.request()
  }

  // Severe weather into the news and as a pop-up, once per warning (#189,
  // WeatherLogic.severeNews); omarchy-buddy-say skips a key already listed.
  property var told: []
  function tell() {
    var keys = told.concat(app.news.items.map(function(i) { return String(i.key || "") }))
    WeatherLogic.severeNews(report, keys, Date.now() / 1000, app.lang).forEach(function(n) {
      told = told.concat([n.key])
      app.runWithInput([app.repo + "/bin/omarchy-buddy-say", "--level", n.level, "--key", n.key, "--stdin"],
                       JSON.stringify({ title: n.title, body: n.body }))  // the body names the place
    })
  }

  function search(text) {
    if (String(text).trim() === "") return
    found = []
    searchState = "searching"
    start(searcher, WeatherLogic.curlCommand(""), WeatherLogic.searchUrl(text, app.lang))
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

  // Finite helpers (Helper.qml, #255): curl gives up after 10 s per address
  // and 2 MB per answer (WeatherLogic.curl), the helper a little later. One
  // that did not get through counts as offline: the timer tries again, the
  // search with the next words.
  Helper {
    id: locator
    seconds: 20
    limit: 2 << 20
    onDone: (result, output) => {
      if (weather.testing) return
      if (result !== "ok" || output.trim() === "offline") { weather.failed = true; return }
      weather.spot = WeatherLogic.located(weather.place, output)
      weather.placeFailed = !weather.spot
      if (weather.spot) weather.refresh()
    }
  }
  Helper {
    id: fetcher
    property var list: []
    seconds: 60             // up to four addresses (WeatherLogic.sources)
    limit: (8 << 20) + 64   // their answers and separators
    onDone: (result, output) => {
      if (!weather.spot || weather.testing) return
      var now = Date.now() / 1000
      var d = result === "ok" ? WeatherLogic.combine(WeatherLogic.split(output, fetcher.list), weather.spot, now) : null
      weather.fetched = now
      weather.failed = !d
      if (d) { weather.report = d; weather.tell() }
    }
  }
  Helper {
    id: searcher
    seconds: 20
    limit: 2 << 20
    onDone: (result, output) => {
      if (weather.searchState !== "searching") return
      weather.found = result === "ok" ? WeatherLogic.places(output) : []
      weather.searchState = weather.found.length ? "found" : result !== "ok" || output.trim() === "" ? "failed" : "empty"
    }
  }
}
