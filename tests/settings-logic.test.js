"use strict"
const test = require("node:test")
const assert = require("node:assert/strict")
const L = require("./lib/load").load("SettingsLogic.js")

test("Datei fehlt oder ist leer: alles Standard", () => {
  for (const text of ["", "  \n", undefined]) {
    const r = L.parse(text)
    assert.equal(r.ok, true)
    assert.deepEqual(r.settings, L.normalize({}))
  }
  const d = L.normalize({})
  assert.equal(d.zoom, 0)
  assert.equal(d.popupTime, "normal")
  assert.equal(d.whenSharing, "hide")
  assert.equal(d.history, "full")
  assert.equal(d.limitWarn, 80)
  assert.equal("tickerInPill" in d, false)  // #174: gone
  assert.equal(d.reduceMotion, false)
  assert.equal(d.updateCheck, false)  // the live test after updates puts pop-ups on screen: only on request
  assert.equal(L.normalize({ updateCheck: true }).updateCheck, true)
  assert.equal(d.updateNews, true)  // #122: on unless switched off
  assert.equal(L.normalize({ updateNews: false }).updateNews, false)
  assert.equal(L.normalize({ updateNews: "nein" }).updateNews, true)
  assert.equal(d.longCommands, false)  // #168: only when switched on
  assert.equal(L.normalize({ longCommands: true }).longCommands, true)
  assert.equal(L.normalize({ longCommands: "ja" }).longCommands, false)
  assert.equal(d.weather, false)  // #184: Omarchy's weather stays unless switched
  assert.equal(L.normalize({ weather: true }).weather, true)
  assert.equal(L.normalize({ weather: "ja" }).weather, false)
  assert.deepEqual(d.apps, {})
})

test("Kaputte Datei: nicht ok, nichts übernommen", () => {
  for (const text of ["{", "[1,2]", "null", "\"zoom\"", "42"]) {
    const r = L.parse(text)
    assert.equal(r.ok, false, text)
    assert.equal(r.settings, null)
  }
})

test("Von Hand: fehlende Werte Standard, falsche einzeln verworfen", () => {
  const r = L.parse('{"zoom": 1.2, "popupTime": "ewig", "history": "noText", "limitWarn": "x", "apps": {"Spotify": "ignore", "Beeper": "laut", "Slack": "normal"}}')
  assert.equal(r.ok, true)
  assert.equal(r.settings.zoom, 1.2)
  assert.equal(r.settings.popupTime, "normal")
  assert.equal(r.settings.history, "noText")
  assert.equal(r.settings.limitWarn, 80)
  assert.equal(L.parse('{"limitWarn": null}').settings.limitWarn, 80)  // as the status line reads it
  assert.deepEqual(r.settings.apps, { Spotify: "ignore" })
  assert.equal(L.normalize({ zoom: 9 }).zoom, 0)
  assert.equal(L.normalize({ zoom: 3 }).zoom, 0, "größer als 1,6: automatisch")
  assert.equal(L.normalize({ zoom: 0.5 }).zoom, 0, "kleiner als 0,8: automatisch")
  assert.equal(L.normalize({ zoom: 1.6 }).zoom, 1.6)
  assert.equal(L.normalize({ zoom: 0.8 }).zoom, 0.8)
  assert.equal(L.normalize({ limitWarn: 0 }).limitWarn, 0)
  assert.equal(L.normalize({ limitWarn: 140 }).limitWarn, 100)
  assert.equal(L.normalize({ screen: " DP-1 " }).screen, "DP-1")
  assert.equal(L.normalize({ apps: [1] }).apps.constructor, Object)
})

test("Ungültige Werte werden für die Seite genannt", () => {
  const r = L.parse('{"zoom": 3, "language": "fr", "popupTime": "short", "reduceMotion": "ja", "whenSharing": "veil", "apps": {"Slack": "normal", "Beeper": "laut"}, "eigenes": 1}')
  assert.deepEqual(r.invalid, ['zoom: 3', 'reduceMotion: "ja"', 'language: "fr"', 'apps: {"Slack":"normal","Beeper":"laut"}'])
  assert.deepEqual(L.parse(L.serialize(L.normalize({}), {})).invalid, [], "was die Seite schreibt, ist gültig")
  assert.deepEqual(L.parse("").invalid, [])
  assert.deepEqual(L.parse("{").invalid, [])
})

test("Teilen: alter Wert veil heißt jetzt Insel ausblenden", () => {
  assert.equal(L.normalize({ whenSharing: "veil" }).whenSharing, "hide")
  assert.equal(L.hideWhenSharing(L.normalize({ whenSharing: "veil" })), true)
  assert.equal(JSON.parse(L.serialize(L.normalize({ whenSharing: "veil" }))).whenSharing, "hide")
})

test("Speichern: alle Werte, unbekannte Schlüssel bleiben", () => {
  const r = L.parse('{"zoom": 1.15, "eigenes": [1]}')
  assert.deepEqual(r.extra, { eigenes: [1] })
  const text = L.serialize(r.settings, r.extra)
  const back = JSON.parse(text)
  assert.deepEqual(Object.keys(back), Object.keys(L.defaults).concat(["eigenes"]))
  assert.equal(back.zoom, 1.15)
  assert.ok(text.endsWith("}\n"))
  assert.deepEqual(L.parse(text).settings, r.settings)
})

test("Alte Datei mit tickerInPill (#174): kein Fehler, kein Hinweis, fällt beim Speichern weg", () => {
  const r = L.parse(JSON.stringify({ tickerInPill: false, zoom: 1.15 }))
  assert.equal(r.ok, true)
  assert.deepEqual(r.invalid, [])
  assert.deepEqual(r.extra, {})
  assert.equal(r.settings.zoom, 1.15)
  assert.equal("tickerInPill" in JSON.parse(L.serialize(r.settings, r.extra)), false)
})

test("Übernahme aus ui.json", () => {
  const s = L.fromUi(JSON.stringify({ lastRead: 5, quiet: true, zoom: 1.5, updateCheck: false, history: "off",
                                      veilWhenSharing: false, tickerInPill: false, limitWarn: 0, screen: "HDMI-A-1" }))
  assert.equal(s.zoom, 1.5)
  assert.equal(s.updateCheck, false)
  assert.equal(s.history, "off")
  assert.equal(s.whenSharing, "quiet")
  assert.equal("tickerInPill" in s, false)
  assert.equal(s.limitWarn, 0)
  assert.equal(s.screen, "HDMI-A-1")
  assert.equal("lastRead" in s, false)
  assert.equal(L.fromUi(JSON.stringify({ veilWhenSharing: true })).whenSharing, "hide")
  assert.deepEqual(L.fromUi("kaputt"), L.normalize({}))
  assert.deepEqual(L.fromUi(""), L.normalize({}))
})

test("Ändern von der Seite und Regeln pro App", () => {
  let s = L.normalize({})
  s = L.withValue(s, "popupTime", "long")
  assert.equal(s.popupTime, "long")
  assert.equal(L.withValue(s, "popupTime", "quatsch").popupTime, "normal")
  s = L.withAppRule(s, "Spotify", "historyOnly")
  assert.equal(L.appRule(s, "Spotify"), "historyOnly")
  assert.equal(L.appRule(s, "Beeper"), "normal")
  assert.equal(L.appRule(null, "Beeper"), "normal")
  const before = s
  s = L.withAppRule(s, "Spotify", "normal")
  assert.deepEqual(s.apps, {})
  assert.equal(L.appRule(before, "Spotify"), "historyOnly", "das alte Objekt bleibt unverändert")
})

test("Apps auf der Seite: gesendet oder mit Regel, ohne Omarchy und Test", () => {
  const notes = [{ app: "spotify" }, { app: "Beeper" }, { app: "omarchy-action" }, { app: "Beeper" },
                 { app: "Buddy-Test" }, { app: "" }]
  const s = L.withAppRule(L.normalize({}), "Signal", "ignore")
  assert.deepEqual(L.pageApps(notes, s), ["Beeper", "Signal", "spotify"])
  assert.deepEqual(L.pageApps([], L.normalize({})), [])
})

test("Standzeit, Teilen, Größe, Hinweistext", () => {
  assert.equal(L.popupFactor("short"), 0.5)
  assert.equal(L.popupFactor("normal"), 1)
  assert.equal(L.popupFactor("long"), 2)
  const s = mode => L.normalize({ whenSharing: mode })
  assert.equal(L.quietWhenSharing(s("nothing")), false)
  assert.equal(L.quietWhenSharing(s("quiet")), true)
  assert.equal(L.quietWhenSharing(s("hide")), true)
  assert.equal(L.hideWhenSharing(s("quiet")), false)
  assert.equal(L.hideWhenSharing(s("hide")), true)
  assert.equal(L.zoomLabel(0, 1.05), "automatisch (105 %)")
  assert.equal(L.zoomLabel(1.15, 1.05), "115 %")
  assert.equal(L.zoomLabel(0, 1.05, "en"), "automatic (105%)")
  assert.equal(L.zoomLabel(1.15, 1.05, "en"), "115%")
  assert.equal(L.sharingNote(s("hide"), true), "", "die Insel ist dann gar nicht zu sehen")
  assert.equal(L.sharingNote(s("quiet"), true), "still – Bildschirm wird geteilt")
  assert.equal(L.sharingNote(s("nothing"), true), "")
  assert.equal(L.sharingNote(s("quiet"), false), "")
})

test("Bildschirmteilen: Aufnahmen zählen, ein Foto dazwischen beendet nichts", () => {
  let n = 0
  n = L.screencasts(n, "1,0")   // Teilen beginnt
  n = L.screencasts(n, "1,0")   // grim
  n = L.screencasts(n, "0,0")   // grim fertig
  assert.equal(n, 1)
  n = L.screencasts(n, "0,0")
  assert.equal(n, 0)
  assert.equal(L.screencasts(0, "0,1"), 0, "Ende ohne Anfang (Shell neu gestartet)")
  assert.equal(L.screencasts(0, ""), 0)
})

test("Auswahl auf der Seite", () => {
  assert.deepEqual(L.zoomOptions(1.05).map(o => o.label), ["automatisch (105 %)", "90 %", "100 %", "115 %", "130 %"])
  assert.equal(L.zoomOptionsWith(1.05, 1.15).length, 5)
  assert.deepEqual(L.zoomOptionsWith(1.05, 1.5).slice(-1)[0], { value: 1.5, label: "150 %" })
  for (const [list, key] of [[L.popupTimeOptions(), "popupTime"], [L.sharingOptions(), "whenSharing"], [L.historyOptions(), "history"], [L.languageOptions(), "language"]])
    for (const o of list) assert.equal(L.normalize({ [key]: o.value })[key], o.value)
  for (const o of L.appOptions()) assert.equal(L.appRule(L.withAppRule(L.normalize({}), "X", o.value), "X"), o.value)
})

test("Lange Befehle: was das Setup sagt, und die Zeile für chezmoi", () => {
  assert.deepEqual(L.commandsReply("Lange Befehle: Zeile in ~/.bashrc eingetragen.\n"), { note: "Lange Befehle: Zeile in ~/.bashrc eingetragen.", line: "" })
  const line = '[ -r "$HOME/x.sh" ] && . "$HOME/x.sh"'
  assert.deepEqual(L.commandsReply("A\nB: chezmoi …:\n" + line + "\n"), { note: "A\nB: chezmoi …:", line: line })
  assert.deepEqual(L.commandsReply(""), { note: "", line: "" })
})

test("Quellen der Neuigkeiten (#164): Kuma-Adresse, GitHub, fremde Schlüssel bleiben", () => {
  const d = L.normalize({})
  assert.deepEqual(d.feed, { kuma: "", github: true })  // GitHub on unless switched off
  const r = L.parse('{"feed": {"eigen": "x", "an": true, "kuma": " https://k.example/status/a ", "github": false}}')
  assert.deepEqual(r.settings.feed, { eigen: "x", an: true, kuma: "https://k.example/status/a", github: false })
  assert.deepEqual(r.invalid, [])
  assert.deepEqual(JSON.parse(L.serialize(r.settings, r.extra)).feed, r.settings.feed, "fremde Schlüssel bleiben in der Datei")
  assert.deepEqual(L.parse('{"feed": {"kuma": 3, "github": "nein"}}').settings.feed, d.feed)
  assert.deepEqual(L.parse('{"feed": {"github": "nein"}}').invalid, ['feed: {"github":"nein"}'])
  assert.deepEqual(L.parse('{"feed": []}').invalid, ["feed: []"])
  const s = L.withFeed(r.settings, "github", true)
  assert.equal(s.feed.github, true)
  assert.equal(s.feed.eigen, "x")
  assert.equal(r.settings.feed.github, false, "das alte Objekt bleibt unverändert")
  assert.equal(L.withFeed(s, "kuma", "").feed.kuma, "")
})

test("Kuma-Adresse prüfen wie der Feed", () => {
  for (const ok of ["https://status.example.com/status/start", "http://10.0.0.5:3001/status/heim/", " HTTPS://k.example/kuma/status/a "])
    assert.equal(L.kumaAddress(ok), "ok", ok)
  for (const bad of ["status.example.com/status/a", "https://k.example/dashboard", "https://k.example/status/",
                     "https://k.example/status/a/b", "ftp://k.example/status/a", "https:///status/a", "https://k.example/status/a b"])
    assert.equal(L.kumaAddress(bad), "invalid", bad)
  assert.equal(L.kumaAddress("  "), "off")
  assert.equal(L.kumaAddress(undefined), "off")
  assert.deepEqual(L.kumaNote("unreachable", "de"), { text: "Uptime Kuma nicht erreichbar. Gespeichert: Die Insel versucht es alle 15 min wieder.", error: true })
  assert.equal(L.kumaNote("invalid", "en").error, true)
  assert.equal(L.kumaNote("ok", "de").error, false)
  assert.equal(L.kumaNote("off", "de").text, L.kumaNote("", "de").text)
})

test("Agents (#158): nur abgeschaltete stehen in config.json, Zeilen nur für installierte", () => {
  assert.deepEqual(L.normalize({}).agents, {})
  assert.deepEqual(L.normalize({ agents: { codex: false, gemini: true, crush: "aus" } }).agents, { codex: false })
  assert.deepEqual(L.parse('{"agents": {"crush": "aus"}}').invalid, ['agents: {"crush":"aus"}'])
  assert.deepEqual(L.parse('{"agents": {"crush": true, "codex": false}}').invalid, [])
  assert.deepEqual(L.parse('{"agents": []}').invalid, ["agents: []"])
  let s = L.withAgent(L.normalize({}), "cursor-agent", false)
  assert.deepEqual(s.agents, { "cursor-agent": false })
  assert.match(L.serialize(s, {}), /"agents": \{\n    "cursor-agent": false\n  \}/)
  s = L.withAgent(s, "cursor-agent", true)
  assert.deepEqual(s.agents, {})
  const rows = L.agentRows("claude\ncursor-agent\ncodex\nunbekannt\npi-agent\n", L.withAgent(L.normalize({}), "codex", false))
  assert.deepEqual(rows.map(r => [r.id, r.name, r.on, r.untested]), [
    ["codex", "Codex", false, false], ["cursor-agent", "Cursor", true, true], ["pi-agent", "Pi", true, false]])
  assert.deepEqual(L.agentRows("", L.normalize({})), [])
})

test("Agents (#158): ungetestet sind die nie echt gelaufenen", () => {
  const Session = require("./lib/load").load("SessionLogic.js")
  for (const a of L.untestedAgents) assert.ok(Session.agents[a], a)
  for (const a of ["codex", "gemini", "crush", "grok", "opencode", "pi-agent", "omp"])
    assert.equal(L.untestedAgents.includes(a), false, a)
})

test("#182 Schrift: Omarchys, die Liste von omarchy-font-list und Adwaita Sans", () => {
  assert.equal(L.normalize({}).font, "")
  assert.equal(L.normalize({ font: " Adwaita Sans " }).font, "Adwaita Sans")
  assert.equal(L.normalize({ font: 3 }).font, "")
  const opts = L.fontOptions("Adwaita Mono\nJetBrainsMono Nerd Font\n\n", ["Adwaita Sans", "Adwaita Mono"], "", "de")
  assert.deepEqual(opts.map(o => o.value), ["", "Adwaita Mono", "JetBrainsMono Nerd Font", "Adwaita Sans"])
  assert.equal(opts[0].label, "Wie Omarchy")
  assert.equal(opts[1].font, "Adwaita Mono")
  // Ohne Adwaita Sans keine; eine von Hand gesetzte bleibt in der Liste.
  assert.deepEqual(L.fontOptions("", [], "Inter", "en").map(o => o.value), ["", "Inter"])
  assert.equal(L.fontFamily("Adwaita Sans", ["Adwaita Sans"], "monospace"), "Adwaita Sans")
  assert.equal(L.fontFamily("Weg", ["Adwaita Sans"], "monospace"), "monospace")
  assert.equal(L.fontFamily("", ["Adwaita Sans"], "monospace"), "monospace")
})

test("Leiste ordnen (#184): was das Setup anbietet, sonst sein Grund", () => {
  assert.deepEqual(L.barReply("offer\n"), { state: "offer", note: "" })
  assert.deepEqual(L.barReply("undo\n"), { state: "undo", note: "" })
  assert.deepEqual(L.barReply("\n"), { state: "", note: "" })
  assert.deepEqual(L.barReply("shell.json hat eine ungewöhnliche Form\n"), { state: "", note: "shell.json hat eine ungewöhnliche Form" })
})
