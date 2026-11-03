"use strict"
const test = require("node:test")
const assert = require("node:assert/strict")
const L = require("./lib/load").load("ToastLogic.js")

const t = (title, fields) => Object.assign({ title: title, level: "info" }, fields)

test("Flutschutz: bis drei bleiben einzeln, danach eine Sammelmeldung", () => {
  const three = L.fold([t("a")], [t("b"), t("c")], 1)
  assert.deepEqual(three.map(x => x.title), ["a", "b", "c"])
  const four = L.fold(three, [t("d", { level: "warn" })], 7)
  assert.equal(four.length, 1)
  assert.deepEqual([four[0].title, four[0].count, four[0].level, four[0].time, four[0].source],
                   ["4 Meldungen", 4, "warn", 7, "buddy"])
  assert.equal(four[0].body, "a, b, c …")
})

test("Flutschutz: kritische Meldungen werden nie eingesammelt", () => {
  const queue = L.fold([t("x", { sticky: true })], [t("a"), t("b"), t("c"), t("d")], 1)
  assert.deepEqual(queue.map(x => x.title), ["x", "4 Meldungen"])
})

test("Flutschutz: eine Sammelmeldung in der nächsten gibt Namen und Zahl weiter", () => {
  const first = L.fold([], [t("a"), t("b"), t("c"), t("d")], 1)
  const second = L.fold(first, [t("e"), t("f", { count: 3 }), t("g")], 2)
  assert.equal(second.length, 1)
  assert.equal(second[0].title, "9 Meldungen")
  assert.deepEqual(second[0].names, ["a", "b", "c", "d", "e", "f", "g"])
})

test("Zurück am PC: kritische einzeln, der Rest zusammengefasst", () => {
  assert.deepEqual(L.welcomeBack([t("a")], 1).map(x => x.title), ["a"])
  const back = L.welcomeBack([t("a"), t("k", { sticky: true }), t("b")], 1)
  assert.deepEqual(back.map(x => x.title), ["k", "Während du weg warst: 2 Meldungen"])
  assert.deepEqual(L.welcomeBack([], 1), [])
})

test("Nach der offenen Ansicht: kritische einzeln, der Rest zusammengefasst", () => {
  assert.deepEqual(L.afterOpen([t("a")], 1).map(x => x.title), ["a"])
  const after = L.afterOpen([t("a"), t("k", { sticky: true }), t("b", { count: 2 })], 1)
  assert.deepEqual(after.map(x => x.title), ["k", "3 Meldungen"])
})

test("Fertig-Meldung von Claude wartet auf eine Eingabe, Benachrichtigungen nicht", () => {
  assert.equal(L.waitsForInput(t("proj ist fertig", { source: "claude", level: "good" })), true)
  assert.equal(L.waitsForInput(t("proj: Limit erreicht", { source: "claude", level: "error" })), true)
  assert.equal(L.waitsForInput(t("web ist fertig", { source: "codex", level: "good" })), true)
  assert.equal(L.waitsForInput(t("Update", { source: "system" })), false)
  assert.equal(L.waitsForInput(t("Hallo", { source: "app", note: true })), false)
  assert.equal(L.waitsForInput(null), false)
})

test("Standzeit eines Pop-ups", () => {
  assert.equal(L.duration(null), 5000)
  assert.equal(L.duration(t("a")), 5000)
  assert.equal(L.duration(t("a", { level: "error" })), 8000)
  assert.equal(L.duration(t("a", { duration: 3000, level: "error" })), 3000)
  // "Pop-ups bleiben" kurz / lang
  assert.equal(L.duration(t("a"), 0.5), 2500)
  assert.equal(L.duration(t("a", { level: "error" }), 2), 16000)
  assert.equal(L.duration(t("a", { duration: 3000 }), 2), 6000)
  assert.equal(L.duration(t("a"), 0), 5000)
})

test("Neuigkeiten: neueste zuerst, nur neue, ohne das, was man schon sieht", () => {
  const list = L.parseNews(JSON.stringify([{ title: "alt", time: 1 }, { title: "neu", time: 3 }, { title: "mitte", time: 2 }]))
  assert.deepEqual(list.map(x => x.title), ["neu", "mitte", "alt"])
  assert.equal(L.newest(list), 3)
  assert.deepEqual(L.freshNews(list, 1, () => false).map(x => x.title), ["mitte", "neu"])
  assert.deepEqual(L.freshNews(list, 1, x => x.title === "neu").map(x => x.title), ["mitte"])
  // omarchy-buddy-say --quiet: only into the history.
  const quiet = L.parseNews(JSON.stringify([{ title: "still", time: 2, quiet: true }, { title: "laut", time: 3 }]))
  assert.deepEqual(L.freshNews(quiet, 1, () => false).map(x => x.title), ["laut"])
  // --popup-only (a finished agent run, #173): pops up, but is not listed.
  const only = L.parseNews(JSON.stringify([{ title: "fertig", time: 2, popup_only: true }, { title: "Fehler", time: 3 }]))
  assert.deepEqual(L.freshNews(only, 1, () => false).map(x => x.title), ["fertig", "Fehler"])
  assert.deepEqual(L.listed(only).map(x => x.title), ["Fehler"])
  assert.deepEqual(L.parseNews("{}"), [])
  assert.deepEqual(L.parseNews("kaputt"), [])
  assert.equal(L.newest([]), 0)
})

test("Fertige Claude-Läufe im sichtbaren Terminal brauchen kein Pop-up", () => {
  const focused = w => w === "abc"
  const done = { source: "claude", level: "good", window: "abc" }
  assert.equal(L.watching(done, false, focused), true)
  assert.equal(L.watching(done, true, focused), false)
  assert.equal(L.watching(Object.assign({}, done, { window: "zzz" }), false, focused), false)
  assert.equal(L.watching(Object.assign({}, done, { level: "error" }), false, focused), false)
  assert.equal(L.watching({ source: "claude", level: "good", orca: true, watched: true }, false, () => false), true)
  assert.equal(L.watching({ source: "claude", level: "good", orca: true, window: "abc" }, false, focused), false)
  assert.equal(L.watching({ source: "system", level: "good", window: "abc" }, false, focused), false)
})

test("Kritische Pop-ups über einen Neustart: welche, und wie sie zurückkommen", () => {
  const crit = (key, extra) => Object.assign({ key, sticky: true, title: key, actions: [{ id: "o", text: "Öffnen" }], reply: true }, extra)
  const loose = { key: "n", sticky: false, title: "normal" }
  const kept = L.stickyOnes(crit("a"), [loose, crit("b")], [crit("c"), crit("a")])
  assert.deepEqual(kept.map(t => t.key), ["a", "b", "c"])
  assert.deepEqual(L.stickyOnes(null, [loose], []), [])
  const back = L.restoreSticky(JSON.stringify([crit("a", { image: "image://qsimage/1" }), crit("b", { image: "file:///x.png" }), loose, null]))
  assert.deepEqual(back.map(t => t.key), ["a", "b"])
  assert.deepEqual(back[0].actions, [])
  assert.equal(back[0].reply, false)
  assert.equal(back[0].image, "")
  assert.equal(back[1].image, "file:///x.png")
  assert.deepEqual(L.restoreSticky("kaputt"), [])
  assert.deepEqual(L.restoreSticky("{}"), [])
  assert.deepEqual(L.restoreSticky(""), [])
})

test("„jetzt prüfen“ sagt, was es tut und was es fand", () => {
  assert.equal(L.checkLabel({ running: false, done: false, found: 3 }), "jetzt prüfen")
  assert.equal(L.checkLabel({ running: true, done: false, found: 0 }), "prüft …")
  assert.equal(L.checkLabel({ running: false, done: true, found: 0 }), "nichts Neues")
  assert.equal(L.checkLabel({ running: false, done: true, found: 1 }), "1 neu")
  assert.equal(L.checkLabel({ running: false, done: true, found: 4 }), "4 neu")
  assert.equal(L.newSince([{ time: 10 }, { time: 5 }, {}], 5), 2)
})

test("Kritische stehen vorne an, ohne die anderen festzuhalten (B19, F11)", () => {
  const queue = L.fold([t("a"), t("x", { sticky: true })], [t("b"), t("y", { sticky: true })], 1)
  assert.deepEqual(queue.map(x => x.title), ["x", "y", "a", "b"])
  const crit = t("k", { sticky: true })
  // allein bleibt es stehen, wartet etwas, läuft es ab und kommt danach wieder
  assert.equal(L.runsOut(crit, 0, true), false)
  assert.equal(L.runsOut(crit, 1, false), true)
  const step = L.afterTime(crit, [t("a"), t("b")])
  assert.deepEqual([step.toast.title, step.queue.map(x => x.title), step.gone], ["a", ["b", "k"], null])
  const plain = L.afterTime(t("a"), [])
  assert.deepEqual([plain.toast, plain.queue, plain.gone.title], [null, [], "a"])
  assert.equal(L.runsOut(null, 3, true), false)
})

test("„fertig“ wartet nur auf eine Eingabe, solange nichts anderes ansteht (F11)", () => {
  const done = t("fertig", { source: "claude", level: "good" })
  assert.equal(L.runsOut(done, 0, false), false)
  assert.equal(L.runsOut(done, 0, true), true)
  assert.equal(L.runsOut(done, 2, false), true)
  assert.equal(L.runsOut(t("n", { note: true, source: "app" }), 0, false), true)
})

test("Öffnen und Weggehen: was wartet, was bleibt (B45)", () => {
  const crit = t("k", { sticky: true })
  const open = L.onOpen(t("a"), [t("b")], [t("c")])
  assert.deepEqual([open.queue, open.heldBack.map(x => x.title), open.drop], [[], ["c", "b"], true])
  assert.equal(L.onOpen(crit, [], []).drop, false)
  assert.equal(L.onOpen(null, [], []).drop, false)
  const away = L.onLeave(t("a"), [t("b")], [t("c")])
  assert.deepEqual([away.toast, away.queue, away.heldBack.map(x => x.title)], [null, [], ["a", "b", "c"]])
  const empty = L.onLeave(null, [], [t("c")])
  assert.deepEqual([empty.toast, empty.heldBack.length], [null, 1])
})

test("Flut wie in tests/live: sechs einzeln, eine auf dem Schirm, vier gesammelt, eine dahinter", () => {
  let queue = []
  for (let i = 2; i <= 6; i++) queue = L.fold(queue, [t("Flut " + i)], 1, "de")
  assert.deepEqual(queue.map(x => x.title), ["4 Meldungen", "Flut 6"])
})

test("Flüchtiges verfällt beim Zurückhalten: Lautstärke, Screenshot, Lieder (Frage 10)", () => {
  const vol = t("Lautstärke", { ephemeral: true })
  const shot = t("Screenshot gespeichert", { ephemeral: true })
  const song = t("Altes Lied", { media: true })
  assert.deepEqual(L.welcomeBack([vol, shot, song], 1), [])
  const back = L.welcomeBack([vol, t("a"), song, t("b")], 1)
  assert.deepEqual([back.length, back[0].count, back[0].body], [1, 2, "a, b"])
  assert.deepEqual(L.afterOpen([song, t("a")], 1).map(x => x.title), ["a"])
  // A critical one stays, whatever it is.
  assert.deepEqual(L.welcomeBack([t("k", { sticky: true, ephemeral: true })], 1).map(x => x.title), ["k"])
})

test("popups.json folgt „Verlauf speichern“ (Frage 9)", () => {
  const list = [t("Akku", { sticky: true, key: "k", body: "5 %", image: "file:///a.png", replyHint: "x" })]
  assert.deepEqual(L.storedSticky(list, "full"), list)
  assert.deepEqual(L.storedSticky(list.concat([t("Test", { sticky: true, key: "x", app: "Buddy-Test" })]), "full"), list,
                   "eine kritische Testmeldung kommt nie in die Datei (#126)")
  assert.deepEqual(L.storedSticky(list, "off"), [])
  const bare = L.storedSticky(list, "noText")
  assert.deepEqual([bare[0].title, bare[0].body, bare[0].image, bare[0].replyHint], ["Akku", "", "", ""])
  // keine Befehle, weder Klick noch Knöpfe (#155)
  const cmd = [t("Aufnahme", { sticky: true, key: "r", exec: '["mpv","/home/x/a.mp4"]',
                               execActions: [{ label: "Abspielen", argv: ["mpv", "/home/x/a.mp4"] }] })]
  const noCmd = L.storedSticky(cmd, "noText")[0]
  assert.deepEqual([noCmd.exec, noCmd.execActions], ["", []])
  assert.equal(cmd[0].execActions.length, 1)
  assert.equal(list[0].body, "5 %")  // the pop-up on screen keeps its text
  // ohne Überschrift ist der Titel der Text: in der Datei steht der Absender (#170)
  const plain = [t("Ich bin zu spät", { sticky: true, key: "s", app: "Signal", textTitle: true }),
                 t("Hallo", { sticky: true, key: "w", app: "chromium", site: "web.whatsapp.com", textTitle: true })]
  assert.deepEqual(L.storedSticky(plain, "noText").map(x => [x.title, x.body]), [["Signal", ""], ["web.whatsapp.com", ""]])
  assert.equal(plain[0].title, "Ich bin zu spät")
})

test("Vom Absender geschlossen: weg vom Schirm, aus der Warteschlange und den zurückgehaltenen (#155)", () => {
  const a = t("a", { key: "a", count: 1 }), b = t("b", { key: "b", count: 1 }), bundle = t("b+", { key: "b", count: 3 })
  const step = L.afterClosed(a, [b, t("c", { key: "c" })], [b, t("d", { key: "d" })], "b")
  assert.deepEqual([step.queue.map(x => x.key), step.heldBack.map(x => x.key), step.next], [["c"], ["d"], false])
  // ein Bündel steht für weitere Nachrichten und bleibt
  const kept = L.afterClosed(null, [bundle], [bundle], "b")
  assert.deepEqual([kept.queue.length, kept.heldBack.length, kept.next], [1, 1, false])
  // auf dem Schirm: das nächste kommt, außer bei Flüchtigem
  assert.equal(L.afterClosed(a, [], [], "a").next, true)
  assert.equal(L.afterClosed(t("a", { key: "a", count: 1, ephemeral: true }), [], [], "a").next, false)
  assert.equal(L.afterClosed(bundle, [], [], "b").next, false)
})

test("O-Morchys Emotion je Ereignis (#177)", () => {
  const e = L.emoteFor
  assert.equal(e(t("Befehl fertig", { source: "terminal", level: "good" })), "done")
  assert.equal(e(t("Befehl fehlgeschlagen", { source: "terminal", level: "error" })), "failed")
  assert.equal(e(t("Web down", { source: "kuma", level: "warn" })), "outage")
  assert.equal(e(t("Web wieder da", { source: "kuma", level: "good" })), "relief")
  assert.equal(e(t("Absturz", { source: "system", level: "error", action: "crash:42" })), "outage")
  assert.equal(e(t("Teammeeting", { note: true, kind: "event", sticky: true })), "alarm")
  assert.equal(e(t("Rechnung", { note: true, kind: "mail" })), "mail")
  assert.equal(e(t("Mara", { note: true, kind: "chat" })), "chat")
  // As before: talking, a finished agent run celebrating, updates, a plain notification.
  assert.equal(e(t("Lena", { note: true, kind: "" })), "")
  assert.equal(e(t("companion ist fertig", { source: "claude", level: "good" })), "")
  assert.equal(e(t("Updates", { source: "system", action: "updates" })), "")
  assert.equal(e(null), "")
})

test("Mehrere Emotionen: die wichtigste gewinnt, keine Warteschlange (#177)", () => {
  assert.ok(L.emoteWins("ask", "outage"))
  assert.ok(!L.emoteWins("outage", "ask"))
  assert.ok(L.emoteWins("outage", "alarm"))
  assert.ok(!L.emoteWins("alarm", "outage"))
  assert.ok(!L.emoteWins("done", "alarm"))
  assert.ok(L.emoteWins("done", "failed"), "gleich wichtig: die neue spielt")
  assert.ok(L.emoteWins("done", ""))
  assert.ok(L.emoteWins("mail", "squish"), "eine Geste weicht")
  // A summary carries the strongest of what it folds.
  const four = L.fold([t("a", { source: "terminal", level: "good" })],
    [t("b", { note: true, kind: "event", sticky: true }), t("c", { source: "kuma", level: "warn" }), t("d"), t("e", { note: true, kind: "mail" })], 1)
  assert.equal(L.emoteFor(four[0]), "alarm")
  assert.equal(L.emoteFor(four[1]), "outage")
  assert.equal(L.emoteFor(L.welcomeBack([t("x"), t("y")], 1)[0]), "")
})

test("Brief und Sprechblase nur im Pop-up, Hand nur für neue Anfragen (#177)", () => {
  assert.ok(L.popupOnly("mail") && L.popupOnly("chat"))
  assert.ok(!L.popupOnly("done") && !L.popupOnly(""))
  assert.ok(L.newAsk(["s1/r1"], []))
  assert.ok(L.newAsk(["s1/r1", "s2/r1"], ["s1/r1"]))
  assert.ok(!L.newAsk(["s1/r1"], ["s1/r1", "s2/r1"]), "beantwortet oder geblättert: keine neue")
})

test("Erste Minuten (#192): ohne setup.json Einrichten, nach dem ersten Setup einmal die Begrüßung", () => {
  assert.equal(L.firstRun(true, "", 0), "setup")
  assert.equal(L.firstRun(false, '{"since": 500}', 0), "welcome")
  assert.equal(L.firstRun(false, '{"since": 500}', 500), "", "schon begrüßt")
  assert.equal(L.firstRun(false, '{"since": 900}', 500), "welcome", "neu eingerichtet nach dem Entfernen")
  assert.equal(L.firstRun(false, '{"disabledAdded": true}', 0), "", "Setup von vor #192: keine Begrüßung")
  assert.equal(L.firstRun(false, "kaputt", 0), "")
  assert.equal(L.setupSince('{"since": 12.5}'), 12.5)
})

test("Erste Minuten: Pop-ups mit Knopf, bleiben stehen, nie in popups.json", () => {
  const setup = L.setupToast(1, "de"), hello = L.welcomeToast(1, "en", "Lea")
  assert.equal(setup.key, L.setupKey)
  assert.equal(setup.title, "Noch ein Schritt")
  assert.equal(setup.action, "setup")
  assert.equal(hello.title, "Hi, Lea!")
  assert.equal(L.welcomeToast(1, "de", "").title, "Hallo!", "ohne Namen")
  assert.match(hello.body, /^I’m O-Morchy\./)
  assert.equal(hello.action, "try")
  assert.equal(L.emoteFor(hello), "wave", "O-Morchy winkt")
  assert.equal(L.runsOut(setup, 0, true), false)
  assert.equal(L.runsOut(hello, 0, true), false)
  const kept = t("k", { sticky: true, key: "k" })
  assert.deepEqual(L.storedSticky([setup, kept, hello], "full"), [kept])
})
