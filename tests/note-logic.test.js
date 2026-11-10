"use strict"
const test = require("node:test")
const assert = require("node:assert/strict")
const L = require("./lib/load").load("NoteLogic.js")

function raw(fields) {
  return Object.assign({ app: "Beeper", summary: "Tom", body: "Hallo", image: "", imageHint: "", icon: "",
                         category: "", glyph: "", exec: "", urgency: 1, expire: -1, actions: [], reply: false,
                         replyHint: "", transient: false, player: null }, fields)
}

function note(fields, key) { return L.makeNote(raw(fields), key || "k", 100) }

test("Text säubern: Markup, Zeilenumbrüche, Entities", () => {
  assert.equal(L.plain("<b>Hallo</b><br/>Welt &amp; &lt;Co&gt; &quot;x&quot; &#39;y&apos;"), "Hallo\nWelt & <Co> \"x\" 'y'")
  assert.equal(L.plain("  <img src=\"http://x\">  "), "")
  assert.equal(L.plain(undefined), "")
  assert.equal(L.plain("**Fertig:** `tests/run` grün, 2 * 3"), "Fertig: tests/run grün, 2 * 3")
  // Klartext mit spitzen Klammern bleibt (B18)
  assert.equal(L.plain("if a<b && c>d then x"), "if a<b && c>d then x")
  assert.equal(L.plain("<- links, rechts ->"), "<- links, rechts ->")
  assert.equal(L.plain("x <b> y </b> <i && j>"), "x  y  <i && j>")
  assert.equal(L.plain("<img src='a.png' alt=x/>Bild"), "Bild")
  assert.equal(L.plain('<a href="x">Link</a> <span class="y">z</span> <U>u</U>'), "Link z u")
})

test("Bilder nur von diesem Rechner, nie aus dem Netz (B17)", () => {
  assert.equal(L.isRemote("http://127.0.0.1:8766/app-icon.png"), true)
  assert.equal(L.isRemote("https://x.org/a.png"), true)
  assert.equal(L.isRemote("ftp://x.org/a.png"), true)
  assert.equal(L.isRemote("file:///tmp/a.png"), false)
  assert.equal(L.isRemote("image://icon/dialog-information"), false)
  assert.equal(L.isRemote("/tmp/a.png"), false)
  assert.equal(L.isRemote("firefox"), false)
  assert.equal(note({ image: "http://x.org/a.png" }).image, "")
  assert.equal(note({ imageHint: "https://x.org/a.png" }).image, "")
  // Cover vom Player (MPRIS) bleibt
  const song = note({ app: "Spotify", player: { trackArtUrl: "https://i.scdn.co/x", trackTitle: "Lied" } })
  assert.equal(song.image, "https://i.scdn.co/x")
})

test("Einordnen: Gruppe nach App und Absender, Bilder, Icons", () => {
  const n = note({ summary: "<i>Tom</i>", body: "Hi<br>du" })
  assert.equal(n.group, "Beeper\nTom")
  assert.equal(n.summary, "Tom")
  assert.equal(n.body, "Hi\ndu")
  assert.equal(note({ image: "/tmp/a.png" }).image, "file:///tmp/a.png")
  assert.equal(note({ imageHint: "image://icon//tmp/b.png" }).image, "file:///tmp/b.png")
  const themed = note({ imageHint: "image://icon/dialog-information" })
  assert.equal(themed.image, "")
  assert.equal(themed.icon, "image://icon/dialog-information")
  assert.equal(note({ imageHint: "image://icon/x", icon: "/usr/share/icons/b.svg" }).icon, "/usr/share/icons/b.svg")
})

test("Einordnen: Musik, Omarchys Rückmeldungen, Orcas „Claude finished“", () => {
  const player = { trackArtUrl: "https://cover", trackTitle: "Song", trackArtist: "Band" }
  const m = note({ app: "Spotify", summary: "alt", body: "alt", player: player })
  assert.equal(m.media, true)
  assert.equal(m.group, "Spotify")
  assert.deepEqual([m.summary, m.body, m.image], ["Song", "Band", "https://cover"])
  assert.equal(note({ app: "mpv", category: "x-music.track", player: null }).media, true)
  assert.equal(note({ app: "Beeper", player: player }).summary, "Tom")
  assert.equal(note({ app: "omarchy-action" }).ephemeral, true)
  assert.equal(note({ transient: true }).ephemeral, true)
  assert.equal(note({ app: "Orca", summary: "companion / main - Claude finished" }).seen, true)
  assert.equal(note({ app: "Orca", summary: "Update bereit" }).seen, false)
})

test("Ruhemodus-Regeln: was als Pop-up kommt", () => {
  const cases = [
    [{ urgency: 1 }, false, true],
    [{ urgency: 1 }, true, false],
    [{ urgency: 0 }, false, false],
    [{ urgency: 0, transient: true }, false, true],
    [{ urgency: 0, app: "Spotify" }, false, true],
    [{ urgency: 0, app: "Spotify" }, true, false],
    [{ urgency: 2 }, true, true],
    [{ urgency: 1, app: "omarchy-action" }, true, true],
    [{ app: "Orca", summary: "Claude finished" }, false, false],
  ]
  for (const [fields, silent, pops] of cases)
    assert.equal(L.popsUp(note(fields), silent), pops, JSON.stringify(fields) + (silent ? " still" : ""))
})

test("Regeln pro App: nur Verlauf, ignorieren", () => {
  assert.equal(L.popsUp(note({}), false, "normal"), true)
  assert.equal(L.popsUp(note({}), false, "historyOnly"), false)
  assert.equal(L.popsUp(note({ urgency: 2 }), false, "historyOnly"), true, "kritisch kommt trotzdem")
  assert.equal(L.popsUp(note({ app: "Spotify" }), false, "historyOnly"), false)
  assert.equal(L.popsUp(note({ urgency: 2 }), false, "ignore"), false)
  assert.equal(L.kept(note({}), "historyOnly"), true)
  assert.equal(L.kept(note({}), "ignore"), false)
  assert.equal(L.kept(note({ app: "omarchy-action" }), "normal"), false)
  assert.equal(L.kept(note({ transient: true })), false)
  assert.equal(L.kept(note({})), true)
})

test("Standzeit: Musik 3 s, Omarchy 5 s, sonst 8 bis 30 s", () => {
  assert.equal(L.noteToast(note({ app: "Spotify" })).duration, 3000)
  assert.equal(L.noteToast(note({ app: "omarchy-action" })).duration, 5000)
  assert.equal(L.noteToast(note({ expire: -1 })).duration, 8000)
  // expire 0 („nie“) läuft wie alle anderen ab (F17)
  assert.equal(L.noteToast(note({ expire: 0 })).duration, 8000)
  assert.equal(L.noteToast(note({ expire: 12000 })).duration, 12000)
  assert.equal(L.noteToast(note({ expire: 60000 })).duration, 30000)
  const critical = L.noteToast(note({ urgency: 2, summary: "", body: "" }))
  assert.deepEqual([critical.sticky, critical.level, critical.title], [true, "error", "Beeper"])
})

test("Ohne Titel rückt der Text in die Titelzeile (F23)", () => {
  const n = note({ summary: "", body: "Nur Text" })
  assert.deepEqual([L.titleOf(n), L.textOf(n)], ["Nur Text", ""])
  const t = L.noteToast(n)
  assert.deepEqual([t.title, t.body, t.textTitle], ["Nur Text", "", true])
  assert.deepEqual([L.titleOf(note({})), L.textOf(note({}))], ["Tom", "Hallo"])
  assert.equal(L.noteToast(note({})).textTitle, false)
})

test("Neue Nachricht: wohin sie sich einreiht (B45)", () => {
  const a = { group: "A", key: "a" }, b = { group: "B", key: "b" }, c = { group: "C", key: "c" }
  assert.deepEqual(L.joinTarget(a, [b], [c], "A", ""), { where: "toast" })
  // Antwortfeld offen: das Pop-up bleibt, wie es ist
  assert.deepEqual(L.joinTarget(a, [b], [c], "A", "a"), { where: "new" })
  assert.deepEqual(L.joinTarget(a, [c, b], [], "B", ""), { where: "queue", index: 1 })
  assert.deepEqual(L.joinTarget(null, [], [b, c], "C", ""), { where: "held", index: 1 })
  assert.deepEqual(L.joinTarget(null, [], [], "A", ""), { where: "new" })
})

test("Löschen rückgängig: alles an seinen Platz, Neues bleibt (F8)", () => {
  const at = (key, time, fields) => Object.assign(note(fields || {}, key), { time: time })
  const old = [at("c", 30), at("b", 20, { summary: "Ina" }), at("a", 10)]
  assert.deepEqual(L.withRestored([], old).map(n => n.key), ["c", "b", "a"])
  const now = [at("d", 40), at("b", 20, { summary: "Ina" })]
  assert.deepEqual(L.withRestored(now, old).map(n => n.key), ["d", "c", "b", "a"])
  // eine laufende Anzeige kommt nicht doppelt zurück
  const s1 = at("s1", 5, { app: "Spotify" }), s2 = at("s2", 50, { app: "Spotify" })
  assert.deepEqual(L.withRestored([s2], [s1]).map(n => n.key), ["s2"])
  const many = []
  for (let i = 0; i < 100; i++) many.push(at("n" + i, 1000 - i))
  assert.equal(L.withRestored(many, old).length, 100)
})

test("Bündeln: Zähler, kritisch bleibt kritisch, Musik zählt nicht", () => {
  const first = L.noteToast(note({ urgency: 2, body: "eins" }))
  const next = L.merged(first, note({ body: "zwei" }, "k2"))
  assert.deepEqual([next.count, next.body, next.key, next.sticky, next.level], [2, "zwei", "k2", true, "error"])
  assert.equal(L.merged(next, note({}, "k3")).count, 3)
  const song = L.noteToast(note({ app: "Spotify" }))
  assert.equal(L.merged(song, note({ app: "Spotify" })).count, 1)
})

test("Verlauf: neueste oben, laufende Anzeige nur der letzte Stand, Grenzen", () => {
  let notes = []
  for (let i = 0; i < 105; i++) notes = L.addToHistory(notes, note({ summary: "n" + i }, "k" + i)).notes
  assert.equal(notes.length, 100)
  assert.equal(notes[0].key, "k104")
  const added = L.addToHistory(notes.slice(0, 31), note({}, "neu"))
  assert.deepEqual(added.older, ["k75", "k74"])
  const s1 = L.addToHistory([], note({ app: "pamixer", sync: "volume" }, "s1")).notes
  const s2 = L.addToHistory(s1.concat([note({}, "b")]), note({ app: "pamixer", sync: "volume" }, "s2"))
  assert.deepEqual(s2.notes.map(n => n.key), ["s2", "b"])
  assert.deepEqual(s2.replaced, ["s1"])
})

test("Verlauf: Testmeldungen drücken keine echten hinaus und landen nicht in der Datei (#126)", () => {
  let notes = []
  for (let i = 0; i < 99; i++) notes = L.addToHistory(notes, note({}, "echt" + i)).notes
  for (let i = 0; i < 30; i++) notes = L.addToHistory(notes, note({ app: "Buddy-Test" }, "test" + i)).notes
  assert.equal(notes.filter(n => n.app !== "Buddy-Test").length, 99, "kein echter Eintrag fällt heraus")
  notes = L.addToHistory(notes, note({}, "echt99")).notes
  notes = L.addToHistory(notes, note({}, "echt100")).notes
  assert.equal(notes.filter(n => n.app !== "Buddy-Test").length, 100, "echte Meldungen: Grenze wie bisher")
  assert.equal(notes.some(n => n.key === "echt0"), false)
  for (const mode of ["full", "noText"]) {
    const stored = L.storedHistory(notes, mode)
    assert.equal(stored.length, 100)
    assert.equal(stored.some(n => n.app === "Buddy-Test"), false, mode)
  }
  assert.equal(L.withRestored(notes, []).length, notes.length)
})

test("Verlauf: Gruppen, ungelesen", () => {
  const notes = [note({ summary: "Tom" }, "a"), note({ summary: "Ina" }, "b"), note({ summary: "Tom" }, "c")]
  notes[2].time = 10
  const groups = L.groups(notes, 50)
  assert.deepEqual(groups.map(g => [g.note.key, g.count, g.unread]), [["a", 2, true], ["b", 1, true]])
  assert.equal(L.groups(notes, 100)[0].unread, false)
  // als Pop-up gesehen: gelesen
  assert.deepEqual(L.groups(notes, 50, { a: 100 }).map(g => g.unread), [false, true])
  // keine Grenze bei 20 Absendern (F4)
  const many = []
  for (let i = 0; i < 60; i++) many.push(note({ summary: "s" + i }, "k" + i))
  assert.equal(L.groups(many, 0).length, 60)
})

test("Verlauf nach Shell-Neustart: keine Aktionen, keine Antworten, keine qsimage-Bilder", () => {
  const list = L.restoreHistory(JSON.stringify([
    { key: "a", actions: [{ id: "open", text: "Öffnen" }], reply: true, time: "5", image: "image://qsimage/1" },
    { key: "b", urgency: 2, image: "file:///x.png" }, null, { summary: "ohne key" },
  ]))
  assert.deepEqual(list.map(o => [o.key, o.actions.length, o.reply, o.time, o.urgency, o.image]),
                   [["a", 0, false, 5, 1, ""], ["b", 0, false, 0, 2, "file:///x.png"]])
  assert.equal(L.restoreHistory("{}"), null)
  assert.deepEqual(L.restoreHistory("kaputt"), [])
})

test("Knöpfe, Klick-Befehl, Beschriftungen, setDnd", () => {
  const actions = [{ id: "default", text: "x" }, { id: "a", text: "" }, { id: "1", text: "Reply" },
                   { id: "2", text: "b" }, { id: "3", text: "c" }, { id: "4", text: "d" }]
  assert.deepEqual(L.buttons(actions).map(a => a.id), ["1", "2", "3"])
  assert.deepEqual(L.execArgv('["omarchy-launch-screenshot","--x"]'), ["omarchy-launch-screenshot", "--x"])
  assert.equal(L.execArgv('["--rm"]'), null)
  assert.equal(L.execArgv('[1]'), null)
  assert.equal(L.execArgv("rm -rf /"), null)
  assert.equal(L.actionLabel("Mark as read"), "Gelesen")
  assert.equal(L.actionLabel("Snooze"), "Snooze")
  assert.equal(L.appLabel("notify-send"), "System")
  assert.equal(L.appLabel(""), "App")
  for (const v of ["true", "1", "on", "YES"]) assert.equal(L.truthy(v), true, v)
  for (const v of ["false", "0", "", undefined]) assert.equal(L.truthy(v), false, String(v))
})

test("Verlauf speichern: ganz, ohne Text, gar nicht", () => {
  const n = note({ body: "Geheim", image: "/tmp/foto.png", replyHint: "Antwort an Tom" })
  assert.equal(L.historyMode("noText"), "noText")
  assert.equal(L.historyMode("quatsch"), "full")
  assert.equal(L.historyMode(undefined), "full")
  assert.deepEqual(L.storedHistory([n], "full"), [n])
  assert.deepEqual(L.storedHistory([n], "off"), [])
  const [bare] = L.storedHistory([n], "noText")
  assert.equal(bare.body, "")
  assert.equal(bare.image, "")
  assert.equal(bare.replyHint, "")
  assert.equal(bare.summary, "Tom")
  assert.equal(bare.app, "Beeper")
  assert.equal(bare.group, n.group)
  assert.equal(n.body, "Geheim", "die Liste im Speicher bleibt ganz")
  // Gespeichertes ohne Text kommt nach dem Neustart wieder.
  assert.equal(L.restoreHistory(JSON.stringify([bare]))[0].summary, "Tom")
})

test("x-canonical-private-synchronous: ersetzt statt bündeln, im Verlauf nur die letzte", () => {
  const v1 = note({ app: "System", summary: "Lautstärke 40 %", sync: "volume" }, "v1")
  const v2 = note({ app: "System", summary: "Lautstärke 50 %", sync: "volume" }, "v2")
  assert.equal(v1.replaces, true)
  // gleicher Tag, anderer Text: eine Gruppe
  assert.equal(v1.group, v2.group)
  assert.notEqual(v1.group, note({ app: "System", summary: "Lautstärke 40 %", sync: "brightness" }).group)
  assert.notEqual(v1.group, note({ app: "System", summary: "Lautstärke 40 %" }).group)
  assert.equal(note({}).replaces, false)
  // auf dem Schirm: das neue ersetzt das alte, kein „2 Nachrichten“
  const shown = L.merged(L.noteToast(v1), v2)
  assert.equal(shown.count, 1)
  assert.equal(shown.title, "Lautstärke 50 %")
  // normale Nachrichten bündeln weiter
  assert.equal(L.merged(L.noteToast(note({}, "a")), note({}, "b")).count, 2)
  // im Verlauf: der alte Eintrag geht
  const other = note({}, "x")
  const h = L.addToHistory([v1, other], v2)
  assert.deepEqual(h.notes.map(n => n.key), ["v2", "x"])
  assert.deepEqual(h.replaced, ["v1"])
  // kein ungelesener Punkt für Lautstärke & Co.
  assert.equal(L.isUnread(v2, 0), false)
  // nur als Pop-up, nicht im Verlauf (F25), auch bei niedriger Dringlichkeit
  assert.equal(L.kept(v2, "normal"), false)
  assert.equal(L.popsUp(note({ urgency: 0, sync: "volume" }), false, "normal"), true)
})

test("Nachrichten von Menschen: Kategorie zuerst, sonst bekannte Apps (#123)", () => {
  assert.equal(L.messageKind("Irgendwas", "", "im.received"), "chat")
  assert.equal(L.messageKind("Irgendwas", "", "im"), "chat")
  assert.equal(L.messageKind("Irgendwas", "", "email.arrived"), "mail")
  assert.equal(L.messageKind("Irgendwas", "", "EMAIL"), "mail")
  // Nicht von Menschen, auch wenn die App eine Chat-App ist
  assert.equal(L.messageKind("Signal", "", "im.error"), "")
  assert.equal(L.messageKind("Thunderbird", "", "email.bounced"), "")
  // Ersatz: App-Name oder Desktop-Eintrag, ganze Wörter
  assert.equal(L.messageKind("Signal", "", ""), "chat")
  assert.equal(L.messageKind("Beeper", "", "device"), "chat")
  assert.equal(L.messageKind("Telegram Desktop", "", ""), "chat")
  assert.equal(L.messageKind("", "org.telegram.desktop", ""), "chat")
  assert.equal(L.messageKind("Chromium", "im.riot.Riot.desktop", ""), "chat")
  assert.equal(L.messageKind("Mozilla Thunderbird", "", ""), "mail")
  assert.equal(L.messageKind("", "org.gnome.Geary", ""), "mail")
  assert.equal(L.messageKind("Gmail", "", ""), "mail")
  assert.equal(L.messageKind("notify-send", "", ""), "")
  assert.equal(L.messageKind("Spotify", "spotify", ""), "")
  assert.equal(L.messageKind("WireGuard", "", ""), "")
  assert.equal(L.messageKind("Signalmanager", "", ""), "")
  assert.equal(L.messageKind(undefined, undefined, undefined), "")
})

test("Nachrichten von Menschen: im Datensatz, im Pop-up, im Namen, im alten Verlauf (#123)", () => {
  const n = note({ app: "Beeper" })
  assert.equal(n.kind, "chat")
  assert.equal(L.noteToast(n).kind, "chat")
  assert.equal(note({ app: "Firefox", category: "email.arrived" }).kind, "mail")
  assert.equal(note({ app: "Buddy-Test", entry: "org.gnome.Evolution" }).kind, "mail")
  assert.equal(note({ app: "Spotify", category: "im" }).kind, "")
  assert.equal(note({ app: "System" }).kind, "")
  assert.equal(L.noteName(n, "de"), "Beeper, Chatnachricht: Tom")
  assert.equal(L.noteName(note({ app: "Geary", summary: "Rechnung" }), "en"), "Geary, Email: Rechnung")
  assert.equal(L.noteName(note({ app: "notify-send", summary: "Hi" }), "de"), "System: Hi")
  const back = L.restoreHistory(JSON.stringify([{ key: "a", app: "Signal" }, { key: "b", app: "Signal", kind: "" }]))
  assert.deepEqual(back.map(o => o.kind), ["chat", ""])
})

test("Nachrichten von Menschen: Omarchys Web-Apps (#123)", () => {
  assert.equal(L.messageKind("Google Messages", "", ""), "chat")
  assert.equal(L.messageKind("", "google-messages", ""), "chat")
  assert.equal(L.messageKind("HEY", "", ""), "mail")
  assert.equal(L.messageKind("Heynote", "", ""), "")
})

// Kalender-Erinnerungen (#166): aufgenommen oder nach Quelle gebaut.
const calendarDir = require("path").join(__dirname, "fixtures", "calendar-notes")
for (const file of require("fs").readdirSync(calendarDir).sort()) {
  test("Kalender-Erinnerung: " + file + " (#166)", () => {
    const f = JSON.parse(require("fs").readFileSync(require("path").join(calendarDir, file), "utf8"))
    const n = note({ app: f.app, summary: f.summary, body: f.body, icon: f.icon, imageHint: f.hints["image-path"] || "",
                     entry: f.hints["desktop-entry"] || "", category: f.hints.category || "", urgency: f.hints.urgency, expire: f.timeout })
    assert.deepEqual({ kind: n.kind, sender: L.senderOf(n), title: L.titleOf(n), body: L.textOf(n) }, f.erwartet)
  })
}

test("Kalender-Erinnerungen: Zeichen, Name, Bündel, Web (#166)", () => {
  // Früher machte "evolution" daraus eine E-Mail.
  assert.equal(L.messageKind("evolution-alarm-notify", "", ""), "event")
  assert.equal(L.messageKind("Kalender-Erinnerungen", "org.kde.kalendarac", ""), "event")
  assert.equal(L.messageKind("Evolution", "org.gnome.Evolution", ""), "mail")
  const a = note({ app: "evolution-alarm-notify", summary: "Erinnerungen", body: "Teammeeting\nSa 14:42" })
  const b = note({ app: "evolution-alarm-notify", summary: "Erinnerungen", body: "Zahnarzt\nSa 16:00" })
  assert.equal(L.noteName(a, "de"), "Erinnerungen, Termin: Teammeeting")
  assert.equal(L.noteName(a, "en"), "Erinnerungen, Event: Teammeeting")
  assert.notEqual(a.group, b.group)  // jeder Termin für sich
  // Ohne Text bleibt alles, wie es kam
  const empty = note({ app: "evolution-alarm-notify", summary: "Erinnerungen", body: "" })
  assert.equal(L.titleOf(empty), "Erinnerungen")
  assert.equal(L.senderOf(empty), "evolution-alarm-notify")
  // Web: eigene Kalender-Seiten, Tuta nur mit gleichem Titel und Text
  assert.equal(web("calendar.proton.me", "Calendar alarm", "Teammeeting starts at 14:42").site, "Proton Calendar")
  assert.equal(web("calendar.zoho.eu", "Teammeeting", "14:42").kind, "event")
  const mail = web("app.tuta.com", "Neue E-Mail", "1 neue E-Mail")
  assert.equal(mail.kind, "mail")
  assert.equal(mail.body, "1 neue E-Mail")
  // Outlook: Termine und Mails von derselben Seite, nicht zu unterscheiden
  assert.equal(web("outlook.office.com", "Teammeeting", "14:42").kind, "mail")
  // Die Pille zeigt den Kalender für eine ungelesene Erinnerung
  assert.equal(L.noteToast(a).kind, "event")
})

test("Termine bleiben stehen, ohne Rot, im Ruhemodus nur im Verlauf (#169)", () => {
  const event = note({ app: "evolution-alarm-notify", summary: "Teammeeting" })
  const t = L.noteToast(event)
  assert.deepEqual([t.sticky, t.level], [true, "info"])
  assert.equal(L.popsUp(event, false), true)
  assert.equal(L.popsUp(event, true), false)
  assert.equal(L.popsUp(note({ app: "evolution-alarm-notify", urgency: 2 }), true), false, "auch dringend still")
  assert.equal(L.kept(event), true)
  const two = L.merged(t, note({ app: "evolution-alarm-notify", summary: "Teammeeting" }, "k2"))
  assert.deepEqual([two.sticky, two.level], [true, "info"])
  assert.equal(L.noteToast(note({})).sticky, false)
})

// Omarchy 4.5: omarchy-notification-send --action (om45/bin/omarchy-notification-send:213-235,
// so gebaut für die Bildschirmaufnahme in om45/bin/omarchy-capture-screenrecording:451).
const recording = {
  actions: '[{"label":"Abspielen","argv":["mpv","--","/home/u/Videos/rec.mp4"]},{"label":"Omacut","argv":["omacut","/home/u/Videos/rec.mp4"]}]',
  exec: '["mpv","--","/home/u/Videos/rec.mp4"]',
}

test("Omarchys Knöpfe (Hint omarchy-actions): lesen und prüfen wie den Klick-Befehl", () => {
  assert.deepEqual(L.execActions(recording.actions), [
    { label: "Abspielen", argv: ["mpv", "--", "/home/u/Videos/rec.mp4"] },
    { label: "Omacut", argv: ["omacut", "/home/u/Videos/rec.mp4"] }])
  // alles oder nichts, wie Omarchy (Security.parseExecActions)
  for (const bad of ["", "kaputt", "{}", "[]", '[{"label":"x","argv":["--rm"]}]', '[{"label":" ","argv":["a"]}]',
                     '[{"label":"x","argv":"a"}]', '[{"label":"a","argv":["a"]},{"label":"b","argv":[1]}]',
                     JSON.stringify([1, 2, 3, 4].map(i => ({ label: "x" + i, argv: ["a"] })))])
    assert.equal(L.execActions(bad), null, bad)
})

test("Omarchys Knöpfe: im Datensatz, vor den Knöpfen des Absenders, im Verlauf", () => {
  const n = note({ app: "omarchy-action", summary: "Aufnahme gespeichert", exec: recording.exec, execActions: recording.actions, expire: 10000 })
  assert.equal(n.execActions.length, 2)
  // mit Knöpfen kein flüchtiger Hinweis: kommt in den Verlauf, steht so lange wie andere Meldungen
  assert.equal(n.ephemeral, false)
  assert.equal(L.kept(n, ""), true)
  assert.equal(L.toastDuration(n), 10000)
  assert.equal(L.toastDuration(note({ app: "omarchy-action" })), 5000)
  assert.equal(note({ app: "omarchy-action" }).ephemeral, true)
  assert.deepEqual(L.noteToast(n).execActions, n.execActions)
  const sender = [{ id: "default", text: "" }, { id: "ok", text: "OK" }]
  assert.deepEqual(L.noteButtons({ execActions: n.execActions, actions: sender }, true),
                   [{ id: "exec:0", text: "Abspielen" }, { id: "exec:1", text: "Omacut" }, { id: "ok", text: "OK" }])
  // ohne lebenden Absender bleiben Omarchys Knöpfe
  assert.deepEqual(L.noteButtons({ execActions: n.execActions, actions: sender }, false).map(b => b.id), ["exec:0", "exec:1"])
  assert.deepEqual(L.noteButtons({ actions: sender }, true).map(b => b.id), ["ok"])
  // nach einem Shell-Neustart noch da (der Absender ist längst weg), kaputte fallen raus
  const back = L.restoreHistory(JSON.stringify([n, { key: "x", execActions: [{ label: "x", argv: ["-x"] }] }]))
  assert.deepEqual(back[0].execActions, n.execActions)
  assert.deepEqual(back[1].execActions, [])
  // "ohne Text" speichert keine Befehle, weder Knöpfe noch Klick (ihr argv nennt Dateien, #155)
  const [bare] = L.storedHistory([n], "noText")
  assert.deepEqual([bare.execActions, bare.exec], [[], ""])
  assert.equal(n.exec, recording.exec, "die Liste im Speicher bleibt ganz")
  assert.equal(L.sameContent(n, note({ app: "omarchy-action", summary: "Aufnahme gespeichert", exec: recording.exec })), false)
})

test("notifications.act wie in Omarchy 4.5 (Service.qml actOnNewest)", () => {
  const toast = { note: true }
  assert.equal(L.actOn(null, [], false), "none")
  assert.equal(L.actOn({ note: false }, [], false), "activate")  // Neuigkeit: ihr Klick
  assert.equal(L.actOn(toast, [], false), "dismiss")
  assert.equal(L.actOn(toast, [], true), "activate")
  assert.equal(L.actOn(toast, [{ id: "ok" }], false), "press")
  assert.equal(L.actOn(toast, [{ id: "ok" }], true), "keyboard")
  assert.equal(L.actOn(toast, [{ id: "a" }, { id: "b" }], false), "keyboard")
  // ein Omarchy-Knopf: der Klick ist derselbe Befehl, also nur eine Sache
  const one = { note: true, execActions: [{ label: "Abspielen", argv: ["mpv"] }] }
  assert.equal(L.actOn(one, L.noteButtons(one, true), true), "activate")
  const two = { note: true, execActions: L.execActions(recording.actions) }
  assert.equal(L.actOn(two, L.noteButtons(two, true), true), "keyboard")
})

test("Lieder: nur Pop-up, nie im Verlauf, alte Einträge gehen beim Laden (#139)", () => {
  const song = note({ app: "Spotify" }, "s1")
  assert.equal(L.popsUp(song, false, "normal"), true)
  assert.equal(L.kept(song, "normal"), false)
  assert.equal(L.kept(L.noteToast(song)), false, "das Pop-up lässt nichts zurück")
  assert.equal(L.kept(L.noteToast(note({}))), true)
  const back = L.restoreHistory(JSON.stringify([{ key: "a", app: "Signal" }, { key: "s", app: "Spotify", media: true }]))
  assert.deepEqual(back.map(o => o.key), ["a"])
})

// Wie Chromium 155 sie schickt (aufgenommen mit einem Fake-Server).
function web(host, summary, text, fields) {
  return note(Object.assign({ app: "Chromium", entry: "chromium", summary: summary, body: host + "\n\n" + text }, fields))
}

test("Web-Benachrichtigungen: Seite als Absender, Chat und Mail (#147)", () => {
  const ig = web("www.instagram.com", "anna.b", "Hey, hast du kurz Zeit?")
  assert.equal(ig.site, "Instagram")
  assert.equal(ig.kind, "chat")
  assert.equal(ig.body, "Hey, hast du kurz Zeit?")
  assert.equal(ig.app, "Chromium")  // Regeln und Fokus bleiben beim Browser
  assert.equal(L.senderOf(ig), "Instagram")
  assert.equal(L.noteName(ig, "de"), "Instagram, Chatnachricht: anna.b")
  assert.equal(L.noteToast(ig).site, "Instagram")
  assert.equal(web("discord.com", "Ben", "hi").site, "Discord")
  assert.equal(web("web.whatsapp.com", "Ben", "hi").kind, "chat")
  assert.equal(web("x.com", "Ben", "hi").site, "X")
  assert.equal(web("www.messenger.com", "Ben", "hi").site, "Messenger")
  const gm = web("mail.google.com", "Neue E-Mail", "Rechnung", { app: "Google Chrome", entry: "google-chrome" })
  assert.equal(gm.site, "Gmail")
  assert.equal(gm.kind, "mail")
  assert.equal(web("outlook.office.com", "Chef", "Termin").site, "Outlook")
  // Mit Markup-Server: ein Link um die Herkunft
  const a = note({ app: "Brave", body: '<a href="https://discord.com/">discord.com</a>\n\nhallo' })
  assert.equal(a.site, "Discord")
  assert.equal(a.body, "hallo")
  // Nur Herkunft, kein Text
  assert.equal(web("discord.com", "Ben", "").body, "")
})

test("Web-Benachrichtigungen: unbekannte Seiten mit Host, nichts geraten (#147)", () => {
  const u = web("www.example.com", "Build fertig", "grün")
  assert.equal(u.site, "example.com")
  assert.equal(u.kind, "")
  assert.equal(u.body, "grün")
  assert.equal(web("localhost:8147", "t", "x").site, "localhost:8147")
  // Andere Seiten, gleicher Titel: eigene Gruppen
  assert.notEqual(web("discord.com", "Anna", "a").group, web("www.instagram.com", "Anna", "a").group)
  // Ohne Herkunftsabsatz, aus Firefox oder einer anderen App: wie bisher
  assert.equal(note({ app: "Chromium", body: "Download fertig" }).site, "")
  assert.equal(note({ app: "Chromium", body: "Download fertig" }).body, "Download fertig")
  assert.equal(note({ app: "Firefox", entry: "firefox", body: "Hey" }).site, "")
  assert.equal(note({ app: "Beeper", body: "instagram.com\n\nHey" }).body, "instagram.com\n\nHey")
  assert.equal(note({ app: "Chromium", body: "Hallo Welt\n\nzwei" }).site, "")
  assert.equal(L.senderOf(note({ app: "notify-send" })), "System")
  // Chromiums „Settings“ fällt nur bei erkannter Web-Herkunft weg (#163)
  const chromiumActions = [{ id: "default", text: "Activate" }, { id: "settings", text: "Settings" }]
  assert.deepEqual(web("discord.com", "Ben", "hi", { actions: chromiumActions.concat([{ id: "reply", text: "Antworten" }]) }).actions,
                   [{ id: "default", text: "Activate" }, { id: "reply", text: "Antworten" }])
  assert.deepEqual(note({ app: "Chromium", body: "Download fertig", actions: chromiumActions }).actions, chromiumActions)
  assert.deepEqual(note({ app: "Beeper", actions: chromiumActions }).actions, chromiumActions)
  // Alter Verlauf ohne site
  assert.equal(L.senderOf({ app: "Chromium" }), "Chromium")
})

test("replaces_id: die neue Fassung ersetzt die alte und poppt wieder auf (#155)", () => {
  const v1 = note({ summary: "Tom", body: "Hallo" }, "a")
  const v2 = L.makeNote(raw({ summary: "Tom", body: "Bist du da?" }), "a", 200)
  // im Verlauf: derselbe Schlüssel, nach oben, kein Doppel
  const h = L.addToHistory([note({}, "x"), v1], v2)
  assert.deepEqual(h.notes.map(n => [n.key, n.body]), [["a", "Bist du da?"], ["x", "Hallo"]])
  assert.deepEqual(h.replaced, [])
  // eine laufende Anzeige gibt beim Umschreiben nicht ihr eigenes Objekt frei
  const s1 = note({ app: "pamixer", sync: "volume", summary: "40 %" }, "s")
  const s2 = note({ app: "pamixer", sync: "volume", summary: "50 %" }, "s")
  assert.deepEqual(L.addToHistory([s1], s2).replaced, [])
  // auf dem Schirm, wartend oder zurückgehalten: das Pop-up folgt, Zahl und „bleibt stehen“ bleiben
  const shown = Object.assign(L.noteToast(v1, 2), { sticky: true })
  const other = L.noteToast(note({ summary: "Anna" }, "y"))
  const onScreen = L.rewrite(shown, [other], [], v2)
  assert.equal(onScreen.found, true)
  assert.deepEqual([onScreen.toast.body, onScreen.toast.count, onScreen.toast.sticky], ["Bist du da?", 2, true])
  assert.equal(onScreen.queue[0], other)
  const waiting = L.rewrite(other, [L.noteToast(v1)], [L.noteToast(v1)], v2)
  assert.equal(waiting.toast, other)
  assert.deepEqual([waiting.queue[0].body, waiting.heldBack[0].body], ["Bist du da?", "Bist du da?"])
  // nirgends zu sehen: neu aufpoppen (Notifications.qml: showNote)
  const gone = L.rewrite(null, [other], [], v2)
  assert.deepEqual([gone.found, gone.toast, gone.queue], [false, null, [other]])
})

test("Benachrichtigungsdienst erst, wenn Omarchys eigener aus ist (#187)", () => {
  const on = JSON.stringify({ version: 1, disabledPlugins: ["omarchy.background", "omarchy.notifications"] })
  assert.equal(L.serving(on, false), true)
  // Plugin aktiviert, Setup nicht gelaufen: Omarchys Dienst läuft weiter
  assert.equal(L.serving(JSON.stringify({ version: 1, plugins: ["io.github.destrukt1v.omarchy-buddy"] }), false), false)
  assert.equal(L.serving(JSON.stringify({ version: 1, disabledPlugins: ["omarchy.background"] }), true), false)
  assert.equal(L.serving("null", true), false)
  // halb geschrieben: bleibt, wie es war
  assert.equal(L.serving('{"version": 1, "disab', true), true)
  assert.equal(L.serving('{"version": 1, "disab', false), false)
})

test("Mit KI ansehen: nur kritisch, ohne eigenen Knopf, nie Nachrichten, Musik, Anrufe (#235)", () => {
  const crit = f => note(Object.assign({ app: "backup", summary: "Sicherung fehlgeschlagen", body: "Platte voll", urgency: 2 }, f))
  assert.equal(crit().ai, true)
  assert.equal(crit({ urgency: 1 }).ai, false, "nur kritisch")
  assert.equal(crit({ app: "Signal" }).ai, false, "Chat")
  assert.equal(crit({ app: "Thunderbird" }).ai, false, "Mail")
  assert.equal(crit({ category: "im.received" }).ai, false, "Chat nach Kategorie")
  assert.equal(crit({ app: "evolution-alarm-notify" }).ai, false, "Termin")
  assert.equal(crit({ app: "Spotify" }).ai, false, "Musik")
  assert.equal(crit({ category: "call.incoming" }).ai, false, "Anruf nach Kategorie")
  assert.equal(crit({ app: "GNOME Calls" }).ai, false, "Anruf-App")
  assert.equal(crit({ exec: '["omarchy-agent-crash","1"]' }).ai, false, "eigener Klick-Befehl")
  assert.equal(crit({ execActions: recording.actions }).ai, false, "Omarchys Knöpfe")
  assert.equal(crit({ actions: [{ id: "retry", text: "Nochmal" }] }).ai, false, "Knöpfe des Absenders")
  assert.equal(crit({ actions: [{ id: "default", text: "" }] }).ai, true, "nur ein Klick ist kein Knopf")
  assert.equal(crit({ reply: true }).ai, false, "Antwortfeld")
  // Pop-up und Verlauf tragen es, auch über einen Shell-Neustart
  const n = crit()
  assert.equal(L.noteToast(n).ai, true)
  assert.equal(L.restoreHistory(JSON.stringify([n]))[0].ai, true)
  // als letzter Knopf, nur wenn eingeschaltet und ein Standard-Agent da ist
  assert.deepEqual(L.noteButtons(n, true, true, "de"), [{ id: "ai", text: "Mit KI ansehen" }])
  assert.deepEqual(L.noteButtons(n, false, true, "en"), [{ id: "ai", text: "Ask AI" }], "auch ohne lebenden Absender (Verlauf)")
  assert.deepEqual(L.noteButtons(n, true, false, "de"), [])
  assert.deepEqual(L.noteButtons(note({}), true, true, "de"), [])
  const both = Object.assign({}, n, { execActions: [{ label: "Log", argv: ["less"] }] })
  assert.deepEqual(L.noteButtons(both, true, true, "de").map(b => b.id), ["exec:0", "ai"])
})

test("Mit KI ansehen: was der Agent bekommt, aus Pop-up und Verlauf gleich (#235)", () => {
  const n = note({ app: "backup", summary: "Sicherung fehlgeschlagen", body: "Platte voll", urgency: 2 })
  const want = { sender: "backup", title: "Sicherung fehlgeschlagen", text: "Platte voll" }
  assert.deepEqual(JSON.parse(L.aiInput(n)), want)
  assert.deepEqual(JSON.parse(L.aiInput(L.noteToast(n))), want)
  const untitled = note({ app: "backup", summary: "", body: "Platte voll", urgency: 2 })
  assert.deepEqual(JSON.parse(L.aiInput(L.noteToast(untitled))), { sender: "backup", title: "Platte voll", text: "" })
  assert.deepEqual(JSON.parse(L.aiInput(untitled)), { sender: "backup", title: "Platte voll", text: "" })
})
