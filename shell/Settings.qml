import QtQuick
import Quickshell
import Quickshell.Io
import "theme"
import "SettingsLogic.js" as SettingsLogic

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
    commandsSetup.command = [setup, "--commands", on ? "on" : "off"]
    commandsSetup.running = true
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
    weatherSetup.command = [setup, "--weather", on ? "on" : "off"]
    weatherSetup.running = true
  }
  function checkBar(arrange) {
    if (barSetup.running) return
    barSetup.command = [setup, "--bar"].concat(arrange === undefined ? [] : [arrange ? "on" : "off"])
    barSetup.running = true
  }

  // The agents (#158): the installed ones (the setup knows their folders),
  // checked when the page opens. A switch writes agents.NAME to config.json,
  // then the setup takes that agent's hooks in or out, one switch after the other.
  property string agentsInstalled: ""
  property string agentsNote: ""  // what the setup said when an agent's file stopped it
  property var agentQueue: []
  function checkAgents() { agentsList.running = true }
  function setAgent(agent, on) {
    values = SettingsLogic.withAgent(values, agent, on); save()
    agentsNote = ""
    agentQueue = agentQueue.concat([[agent, on ? "on" : "off"]])
    nextAgent()
  }
  function nextAgent() {
    if (agentSetup.running || agentQueue.length === 0) return
    agentSetup.command = [setup, "--agent"].concat(agentQueue[0])
    agentQueue = agentQueue.slice(1)
    agentSetup.running = true
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
    if (kumaTest.running) { kumaTest.again = true; return }
    kumaTest.url = url
    kumaTest.running = true
  }
  function checkSources() {
    checkKuma()
    ghTest.running = true
  }

  // The update watcher's git clones (#224): the feed lists them (no network),
  // checked when the page opens; a switch writes gitRepos["~/path"] = false.
  property string gitList: ""
  function checkGit() { if (!gitListing.running) gitListing.running = true }
  function setGitRepo(path, on) { values = SettingsLogic.withGitRepo(values, path, on); save() }

  function setAppRule(name, rule) { values = SettingsLogic.withAppRule(values, name, rule); save() }

  function save() {
    if (broken) backup.running = true
    else write()
  }

  function write() { configFile.setText(SettingsLogic.serialize(values, extra)) }

  function edit() { Quickshell.execDetached([app.omarchyBin + "omarchy-launch-editor", file]) }

  Binding { target: Theme; property: "zoomSetting"; value: settings.values.zoom }
  Binding { target: Theme; property: "reduceMotion"; value: settings.values.reduceMotion }
  Binding { target: Theme; property: "fontSetting"; value: settings.values.font }

  // Omarchy's monospace fonts for the page's font choice (#182).
  property string fontList: ""
  Process {
    running: true
    command: [settings.app.omarchyBin + "omarchy-font-list"]
    stdout: StdioCollector { onStreamFinished: settings.fontList = text }
  }

  Connections {
    target: settings.app.prefs
    function onLoadedChanged() { settings.fill() }
  }

  // The folder only for the user, like the state folder; an empty file so the
  // watcher has something to watch.
  Process {
    running: true
    command: ["sh", "-c", "umask 077; mkdir -p \"$1\" && { [ -e \"$1/config.json\" ] || : > \"$1/config.json\"; }", "sh", settings.dir]
    onExited: settings.ready = true
  }
  Process {
    id: commandsSetup
    stdout: StdioCollector { onStreamFinished: settings.commands = SettingsLogic.commandsReply(text) }
  }
  Process {
    id: weatherSetup
    stdout: StdioCollector { onStreamFinished: settings.weatherNote = text.trim() }
  }
  Process {
    id: barSetup
    stdout: StdioCollector {
      onStreamFinished: {
        var r = SettingsLogic.barReply(text)
        settings.barOrder = r.state
        settings.barNote = r.note
      }
    }
  }
  Process {
    id: agentsList
    command: [settings.setup, "--agents"]
    stdout: StdioCollector { onStreamFinished: settings.agentsInstalled = text }
  }
  Process {
    id: agentSetup
    onExited: settings.nextAgent()
    stdout: StdioCollector { onStreamFinished: if (text.trim() !== "") settings.agentsNote = text.trim() }
  }
  Process {
    id: kumaTest
    property string url
    property bool again: false  // the address changed while it ran
    command: [settings.app.feeder, "--test-kuma", url]
    onExited: if (again) { again = false; settings.checkKuma() }
    stdout: StdioCollector {
      onStreamFinished: if (!kumaTest.again && kumaTest.url === settings.values.feed.kuma)
        settings.kumaCheck = text.trim() === "ok" ? "ok" : "unreachable"
    }
  }
  Process {
    id: gitListing
    command: [settings.app.feeder, "--git-list"]
    stdout: StdioCollector { onStreamFinished: settings.gitList = text }
  }
  // Only whether gh has a token (no network, nothing printed): signed out
  // or no gh, the page says how to sign in.
  Process {
    id: ghTest
    command: ["sh", "-c", "gh auth token >/dev/null 2>&1"]
    onExited: (code) => settings.ghSignedIn = code === 0
  }
  Process {
    id: backup
    command: ["cp", "-p", settings.file, settings.file + ".broken"]
    onExited: { settings.broken = false; settings.write() }
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
