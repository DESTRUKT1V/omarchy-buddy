// Contract tests: does what the island relies on still hold on this
// machine? Read-only, against the installed Omarchy (/usr/share/omarchy or
// $OMARCHY_PATH), Quickshell's type files and ~/.config/omarchy/shell.json.
// Skipped where those are missing. Run after Omarchy updates by
// bin/omarchy-buddy-check.
"use strict"
const test = require("node:test")
const assert = require("node:assert/strict")
const fs = require("node:fs")
const os = require("node:os")
const path = require("node:path")
const C = require("./lib/contract")
const { DIR } = require("./lib/load")

const omarchy = process.env.OMARCHY_PATH || "/usr/share/omarchy"
const qmlDir = "/usr/lib/qt6/qml/Quickshell"
const shellJson = path.join(os.homedir(), ".config", "omarchy", "shell.json")
const read = p => fs.readFileSync(p, "utf8")
const ours = C.ipcFunctions(read(path.join(DIR, "Notifications.qml")), "notifications")

test("Vertrag: unser IpcHandler beantwortet, was Omarchys Skripte und Tastenkürzel aufrufen",
     { skip: !fs.existsSync(omarchy) && "kein " + omarchy }, () => {
  const callers = {}
  for (const file of C.files(omarchy, ["themes", ".git"])) {
    let text
    try { text = read(file) } catch (e) { continue }
    if (!text.includes("omarchy-shell") && !text.includes("ipc")) continue
    for (const name of C.ipcCalls(text, "notifications")) (callers[name] = callers[name] || []).push(file)
  }
  assert.ok(Object.keys(callers).length > 0, "keine Aufrufe gefunden – hat Omarchy das Schema geändert?")
  const missing = Object.keys(callers).filter(n => !ours.includes(n))
  assert.deepEqual(missing.map(n => n + " (" + callers[n].join(", ") + ")"), [], "fehlt in Notifications.qml")
})

// Only Omarchy's own tests call these (expand opens its deck as the pointer
// would, probe reports its daemon's state).
const theirsOnly = ["expand", "probe"]

test("Vertrag: unser IpcHandler kann alles, was Omarchys eigenes Plugin anbietet",
     { skip: !fs.existsSync(omarchy) && "kein " + omarchy }, () => {
  const theirs = C.ipcFunctions(read(path.join(omarchy, "shell/plugins/notifications/Service.qml")), "notifications")
  assert.ok(theirs.length > 0, "IpcHandler/ShellIpc in Omarchys Service.qml nicht gefunden")
  assert.deepEqual(theirs.filter(n => !ours.includes(n) && !theirsOnly.includes(n)), [])
})

// The setup turns Omarchy's indicator list minus Dnd into an explicit list
// in shell.json; it follows a newer Omarchy list only from one it knows.
test("Vertrag: das Setup kennt Omarchys Indikatorliste",
     { skip: !fs.existsSync(omarchy) && "kein " + omarchy }, () => {
  const qml = read(path.join(omarchy, "shell/plugins/bar/widgets/Indicators.qml"))
  const m = /defaultIndicatorEntries:\s*(\[[^\]]*\])/.exec(qml)
  assert.ok(m, "defaultIndicatorEntries nicht in Indicators.qml")
  const known = /^KNOWN_DEFAULTS = \[\n([^]*?)\n\]/m.exec(read(path.join(DIR, "..", "bin", "omarchy-buddy-setup")))[1]
    .split("\n").map(l => JSON.stringify(JSON.parse(l.replace(/,\s*#.*$/, ""))))
  assert.ok(known.includes(JSON.stringify(JSON.parse(m[1]))),
            "neue Liste " + m[1] + " – in KNOWN_DEFAULTS (bin/omarchy-buddy-setup) aufnehmen")
})

// What the island reads off Quickshell's types (Notifications.qml,
// theme/Theme.qml). A rename here breaks the island without a load error.
const members = [
  ["Services/Notifications", "Quickshell.Services.Notifications/Notification",
   ["tracked", "transient", "hasInlineReply", "inlineReplyPlaceholder", "sendInlineReply", "actions",
    "urgency", "expireTimeout", "image", "appIcon", "desktopEntry", "hints", "dismiss", "expire", "closed"]],
  ["Services/Notifications", "Quickshell.Services.Notifications/NotificationAction", ["identifier", "text", "invoke"]],
  ["Services/Notifications", "Quickshell.Services.Notifications/NotificationServer",
   ["inlineReplySupported", "actionsSupported", "imageSupported", "persistenceSupported",
    "bodyMarkupSupported", "keepOnReload", "notification"]],
  ["Services/Mpris", "Quickshell.Services.Mpris/Mpris", ["players"]],
  ["Services/Mpris", "Quickshell.Services.Mpris/MprisPlayer",
   ["identity", "desktopEntry", "trackArtUrl", "trackTitle", "trackArtist"]],
  ["", "Quickshell/ShellScreen", ["physicalPixelDensity", "devicePixelRatio"]],
  // Helper.qml (#255): a start failure shows only as runningChanged.
  ["Io", "Quickshell.Io/Process", ["running", "command", "stdinEnabled", "stdout", "started", "exited", "runningChanged", "signal", "write"]],
  ["Io", "Quickshell.Io/SplitParser", ["splitMarker"]],
]

for (const [dir, name, wanted] of members) {
  test("Vertrag: Quickshell " + name.split("/")[1] + " hat noch " + wanted.join(", "),
       { skip: !fs.existsSync(qmlDir) && "kein " + qmlDir }, () => {
    const d = path.join(qmlDir, dir)
    const file = fs.readdirSync(d).find(f => f.endsWith(".qmltypes"))
    const have = C.qmlMembers(read(path.join(d, file)), name)
    assert.ok(have, name + " nicht in " + file)
    assert.deepEqual(wanted.filter(m => !have.includes(m)), [])
  })
}

test("Vertrag: omarchy.notifications steht in disabledPlugins",
     { skip: !fs.existsSync(shellJson) && "keine shell.json" }, () => {
  const shell = JSON.parse(read(shellJson))
  assert.ok((shell.disabledPlugins || []).includes("omarchy.notifications"),
            "Omarchys Plugin ist an – zwei Dienste streiten um org.freedesktop.Notifications (Rückfall aktiv?)")
})

// The parsers themselves, on fixed text.
test("Vertrag: Aufrufe und IpcHandler werden richtig gelesen", () => {
  assert.deepEqual(C.ipcCalls('omarchy-shell notifications dismissOne\nomarchy-shell -q notifications dismiss "$1"\n' +
                              "omarchy-shell shell ping", "notifications"), ["dismissOne", "dismiss"])
  // Omarchy 4.5: Lua-Tastenbelegung und default/omarchy/shortcuts
  assert.deepEqual(C.ipcCalls('o.bind("SUPER + comma", "Dismiss", { ipc = "notifications.act" })\n' +
                              'o.bind("XF86AudioNext", "Next", { ipc = "media.next" })\n' +
                              "# { ipc = 'notifications.keyboard' }\nipc notifications.showHistory\n  ipc notifications.x\n",
                              "notifications"), ["act", "keyboard", "showHistory"])
  const qml = 'Item {\n  IpcHandler {\n    target: "other"\n    function a(): void {}\n  }\n' +
              '  IpcHandler {\n    target: "notifications"\n\n    function ping(): string { return "ok" }\n' +
              '    function setDnd(value: string): string {\n      function inner() {}\n    }\n  }\n' +
              '  function after() {}\n}\n'
  assert.deepEqual(C.ipcFunctions(qml, "notifications"), ["ping", "setDnd", "inner"])
  assert.deepEqual(C.ipcFunctions('  ShellIpc {\n    id: ipcHandler\n    target: "notifications"\n    function act(): string {}\n  }\n',
                                  "notifications"), ["act"])
  const types = 'Module {\n    Component {\n        exports: ["Q/Foo 0.0"]\n        Property { name: "a" }\n    }\n' +
                '    Component {\n        exports: ["Q/FooBar 0.0"]\n        Method { name: "b" }\n    }\n}\n'
  assert.deepEqual(C.qmlMembers(types, "Q/Foo"), ["a"])
  assert.deepEqual(C.qmlMembers(types, "Q/FooBar"), ["b"])
  assert.equal(C.qmlMembers(types, "Q/Nope"), null)
})

test("Vertrag (#184): Omarchys Wetter-Ort liegt, wo Weather.qml ihn liest, und lässt sich so setzen",
     { skip: !fs.existsSync(path.join(omarchy, "bin", "omarchy-weather-location")) && "kein omarchy-weather-location" }, () => {
  const script = read(fs.realpathSync(path.join(omarchy, "bin", "omarchy-weather-location")))
  assert.match(script, /\$HOME\/\.local\/state\/omarchy\/settings\/weather\.json/)
  assert.match(script, /--set <name> \[lat,lon\]/)
  assert.match(script, /--clear/)
  assert.match(read(path.join(DIR, "Weather.qml")), /"\/\.local\/state\/omarchy\/settings\/weather\.json"/)
  const bar = path.join(omarchy, "shell/plugins/panels/weather/manifest.json")
  if (fs.existsSync(bar)) assert.equal(JSON.parse(read(bar)).id, "omarchy.weather", "die ID, die das Setup aus der Leiste nimmt")
})

// #207: the bar routes `shell summon/hide/toggle` and Tab between panels only
// to widgets with open(), close() and opened (findPanelWidget, panelNavigationSlots).
test("Vertrag (#207): BarWidget.qml erfüllt Omarchys Panel-Bedingung",
     { skip: !fs.existsSync(path.join(omarchy, "shell/plugins/bar/Bar.qml")) && "keine Bar.qml" }, () => {
  const bar = read(path.join(omarchy, "shell/plugins/bar/Bar.qml"))
  assert.match(bar, /typeof item\.open !== "function" \|\| typeof item\.close !== "function" \|\| item\.opened === undefined/,
               "Omarchy prüft Panels anders – BarWidget.qml anpassen")
  const ours = read(path.join(DIR, "BarWidget.qml"))
  for (const re of [/function open\(\)/, /function close\(\)/, /function toggle\(\)/, /property bool opened:/])
    assert.match(ours, re)
})

// #220: the setup puts O-Morchy right after the clock (into centerEnd when the
// clock ends the centre box) and finds Omarchy's indicators in the sections
// it knows (SECTIONS in bin/omarchy-buddy-setup). An update that renames the
// sections or moves the clock or the indicators shows up here.
test("Vertrag (#220): Omarchys Leistenbereiche und wo Uhr und Anzeigen stehen",
     { skip: !fs.existsSync(path.join(omarchy, "config/omarchy/shell.json")) && "keine Omarchy-shell.json" }, () => {
  const m = /^SECTIONS = \(([^)]*)\)/m.exec(read(path.join(DIR, "..", "bin", "omarchy-buddy-setup")))
  assert.ok(m, "SECTIONS nicht in bin/omarchy-buddy-setup")
  const known = m[1].match(/"[^"]*"/g).map(s => JSON.parse(s))
  const util = path.join(omarchy, "shell/Commons/Util.qml")
  if (fs.existsSync(util)) {
    const theirs = /barSections:\s*(\[[^\]]*\])/.exec(read(util))
    assert.ok(theirs, "barSections nicht in Util.qml")
    assert.deepEqual(JSON.parse(theirs[1]), known, "Omarchys Leistenbereiche – SECTIONS im Setup anpassen")
  }
  const layout = JSON.parse(read(path.join(omarchy, "config/omarchy/shell.json"))).bar.layout
  assert.deepEqual(Object.keys(layout).filter(k => !known.includes(k)), [], "unbekannte Bereiche in Omarchys Leiste")
  const ids = name => (layout[name] || []).map(e => e.id)
  assert.equal(ids("center").at(-1), "omarchy.clock", "die Uhr beendet nicht mehr den Mittelblock")
  assert.ok(Array.isArray(layout.centerEnd), "kein centerEnd, O-Morchy käme in den Mittelblock")
  assert.ok(ids("centerBegin").includes("omarchy.indicators"), "Omarchys Anzeigen stehen nicht mehr in centerBegin")
})
