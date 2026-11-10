import QtQuick
import Quickshell
import Quickshell.Io
import "theme"
import "SettingsLogic.js" as SettingsLogic
import "HelperLogic.js" as HelperLogic

// The user's settings in ~/.config/omarchy-buddy/config.json (what they mean:
// SettingsLogic.js). The file is watched, so a change by hand works at
// once; missing values are the default. A file that does not parse changes
// nothing: the island keeps the last good values, the settings page says
// so, and saving from the page keeps the broken one as config.json.broken.
// Single values it does not take are named on the page (`invalid`).
// An empty or new file is filled with every setting, the first time with
// what ui.json held until then.
Scope {
  id: settings
  required property var app

  readonly property string dir: (Quickshell.env("XDG_CONFIG_HOME") || app.home + "/.config") + "/omarchy-buddy"
  readonly property string file: dir + "/config.json"
  readonly property string setup: app.repo + "/bin/omarchy-buddy-setup"

  property var values: SettingsLogic.normalize({})
  property var extra: ({})        // keys this version does not know, kept on saving
  property bool broken: false
  property var invalid: []        // "key: value" the file holds but the island does not take
  property bool ready: false      // the folder and the file exist
  property bool fresh: false      // the file is empty: fill it once ui.json is read
  property bool loaded: false     // read once: the language is known (#192's pop-ups)
  property bool held: false       // the values are a test's (Probe.testSettings): never written

  function apply(text) {
    var r = SettingsLogic.parse(text)
    broken = !r.ok
    if (!r.ok) return
    extra = r.extra
    if (JSON.stringify(r.invalid) !== JSON.stringify(invalid)) invalid = r.invalid
    if (String(text || "").trim() === "") { fresh = true; fill(); return }
    if (JSON.stringify(r.settings) !== JSON.stringify(values)) values = r.settings
  }

  function fill() {
    if (!fresh || !app.prefs.loaded) return
    fresh = false
    values = SettingsLogic.fromUi(app.prefs.uiText)
    write()
  }

  function set(key, value) { values = SettingsLogic.withValue(values, key, value); save() }

  // "Lange Befehle melden": the setup puts the line into ~/.bashrc / ~/.zshrc
  // or takes it out; the page shows what it did.
  property var commands: ({ note: "", line: "" })
  function setLongCommands(on) {
    set("longCommands", on)
    commands = { note: "", line: "" }
    commandsSetup.argv = [setup, "--commands", on ? "on" : "off"]
    commandsSetup.request()
  }

  // "Omarchy-Wetter ersetzen" (#184): the setup takes Omarchy's weather out
  // of the bar or puts it back; it says something only when shell.json
  // stopped it. "Leiste ordnen": the setup says what it offers
  // (SettingsLogic.barReply), checked when the page opens.
  property string weatherNote: ""
  property string barOrder: ""
  property string barNote: ""
  function setWeather(on) {
    set("weather", on)
    weatherNote = ""
    weatherSetup.argv = [setup, "--weather", on ? "on" : "off"]
    weatherSetup.request()
  }
  function checkBar(arrange) {
    // A plain check while one runs is not needed; a click runs after it.
    if (barSetup.active && arrange === undefined) return
    barSetup.argv = [setup, "--bar"].concat(arrange === undefined ? [] : [arrange ? "on" : "off"])
    barSetup.request()
  }

  // The agents (#158): the installed ones (the setup knows their folders),
  // checked when the page opens. A switch writes agents.NAME to config.json,
  // then the setup takes that agent's hooks in or out, one switch after the
  // other; switched again while it waits, only the last state is done.
  property string agentsInstalled: ""
  property string agentsNote: ""  // what the setup said when an agent's file stopped it
  property var agentQueue: []
  function checkAgents() { agentsList.start() }
  function setAgent(agent, on) {
    values = SettingsLogic.withAgent(values, agent, on); save()
    agentsNote = ""
    agentQueue = agentQueue.filter(function(a) { return a[0] !== agent }).concat([[agent, on ? "on" : "off"]])
    nextAgent()
  }
  function nextAgent() {
    if (agentSetup.active || agentQueue.length === 0) return
    agentSetup.argv = [setup, "--agent"].concat(agentQueue[0])
    agentQueue = agentQueue.slice(1)
    agentSetup.start()
  }

  // The feed's own sources (Neuigkeiten): the feed reads config.json on
  // every run, so a change needs no restart. Checked when the page opens.
  property string kumaCheck: "off"  // SettingsLogic.kumaNote
  property bool ghSignedIn: true
  function setFeed(key, value) { values = SettingsLogic.withFeed(values, key, value); save() }
  // The field's text: an address that is no status page is not saved.
  function setKuma(text) {
    if (SettingsLogic.kumaAddress(text) === "invalid") { kumaCheck = "invalid"; return }
    setFeed("kuma", String(text).trim())
    checkKuma()
  }
  function checkKuma() {
    var url = values.feed.kuma, address = SettingsLogic.kumaAddress(url)
    kumaCheck = address === "ok" ? "checking" : address
    if (address !== "ok") return
    if (kumaTest.active) { kumaTest.again = true; return }
    kumaTest.url = url
    kumaTest.start()
  }
  function checkSources() {
    checkKuma()
    ghTest.start()
  }

  // The update watcher's git clones (#224): the feed lists them (no network),
  // checked when the page opens; a switch writes gitRepos["~/path"] = false.
  property string gitList: ""
  function checkGit() { gitListing.start() }
  function setGitRepo(path, on) { values = SettingsLogic.withGitRepo(values, path, on); save() }

  function setAppRule(name, rule) { values = SettingsLogic.withAppRule(values, name, rule); save() }

  function save() {
    if (broken) backup.start()
    else write()
  }

  function write() { if (!held) configFile.setText(SettingsLogic.serialize(values, extra)) }

  function edit() { Quickshell.execDetached([app.omarchyBin + "omarchy-launch-editor", file]) }

  Binding { target: Theme; property: "zoomSetting"; value: settings.values.zoom }
  Binding { target: Theme; property: "reduceMotion"; value: settings.values.reduceMotion }
  Binding { target: Theme; property: "fontSetting"; value: settings.values.font }

  // Omarchy's monospace fonts for the page's font choice (#182).
  property string fontList: ""
  Helper {
    argv: [settings.app.omarchyBin + "omarchy-font-list"]
    Component.onCompleted: start()
    onDone: (result, output) => { if (result === "ok") settings.fontList = output }
  }

  Connections {
    target: settings.app.prefs
    function onLoadedChanged() { settings.fill() }
  }

  // The folder only for the user, like the state folder; an empty file so the
  // watcher has something to watch.
  Helper {
    argv: ["sh", "-c", "umask 077; mkdir -p \"$1\" && { [ -e \"$1/config.json\" ] || : > \"$1/config.json\"; }", "sh", settings.dir]
    Component.onCompleted: start()
    onDone: settings.ready = true
  }
  // The background helpers (Helper.qml, #255): each ends after its deadline,
  // and one that did not start, ran too long or said too much leaves a line
  // on the page (HelperLogic.said); the switch tries again.
  Helper {
    id: commandsSetup
    seconds: 60
    onDone: (result, output) => settings.commands = SettingsLogic.commandsReply(HelperLogic.said(result, output, Theme.lang))
  }
  Helper {
    id: weatherSetup
    seconds: 60
    onDone: (result, output) => settings.weatherNote = HelperLogic.said(result, output, Theme.lang).trim()
  }
  Helper {
    id: barSetup
    seconds: 60
    onDone: (result, output) => {
      var r = SettingsLogic.barReply(HelperLogic.said(result, output, Theme.lang))
      settings.barOrder = r.state
      settings.barNote = r.note
    }
  }
  Helper {
    id: agentsList
    argv: [settings.setup, "--agents"]
    onDone: (result, output) => { if (result === "ok") settings.agentsInstalled = output }
  }
  Helper {
    id: agentSetup
    seconds: 60
    onDone: (result, output) => {
      var note = HelperLogic.said(result, output, Theme.lang).trim()
      if (note !== "") settings.agentsNote = note
      settings.nextAgent()
    }
  }
  Helper {
    id: kumaTest
    property string url
    property bool again: false  // the address changed while it ran
    argv: [settings.app.feeder, "--test-kuma", url]
    onDone: (result, output) => {
      if (again) { again = false; settings.checkKuma() }
      else if (url === settings.values.feed.kuma)
        settings.kumaCheck = result === "ok" && output.trim() === "ok" ? "ok" : "unreachable"
    }
  }
  Helper {
    id: gitListing
    argv: [settings.app.feeder, "--git-list"]
    onDone: (result, output) => { if (result === "ok") settings.gitList = output }
  }
  // Only whether gh has a token (no network, nothing printed): signed out
  // or no gh, the page says how to sign in.
  Helper {
    id: ghTest
    argv: ["sh", "-c", "gh auth token >/dev/null 2>&1"]
    onDone: result => settings.ghSignedIn = result === "ok"
  }
  // Without the copy the broken file is not overwritten: the next save tries again.
  Helper {
    id: backup
    argv: ["cp", "-p", settings.file, settings.file + ".broken"]
    onDone: result => { if (result === "ok") { settings.broken = false; settings.write() } }
  }

  FileView {
    id: configFile
    path: settings.ready ? settings.file : ""
    watchChanges: true
    printErrors: false
    onLoaded: { settings.apply(text()); settings.loaded = true }
    onLoadFailed: { settings.apply(""); settings.loaded = true }
    // An editor that empties the file and then fills it sends two changes;
    // reloading at once loses the second ("dropped operation").
    onFileChanged: settle.restart()
  }
  Timer { id: settle; interval: 200; onTriggered: configFile.reload() }
  // Safety net for editors that replace the file (the watcher can lose it).
  Timer {
    interval: 15000
    running: settings.ready
    repeat: true
    onTriggered: configFile.reload()
  }
}
