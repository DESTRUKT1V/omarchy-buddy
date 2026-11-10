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
  // Only four names are kept (three shown, " …" for more); the total stays a number.
  assert.deepEqual(second[0].names, ["a", "b", "c", "d"])
  assert.equal(second[0].body, "a, b, c …")
  // #256: whether it folds only a test's pop-ups goes on as a flag, for the test IPC.
  assert.equal(second[0].testOnly, false)
  const own = L.fold([], [1, 2, 3, 4].map(i => t("x" + i, { app: "Buddy-Test" })), 1)
  assert.equal(L.fold(own, [1, 2, 3, 4].map(i => t("y" + i, { key: "buddy-test-" + i })), 2)[0].testOnly, true)
  assert.equal(L.fold(own, [t("echt", { app: "Beeper" }), t("z"), t("w"), t("v")], 2)[0].testOnly, false)
})

// #254 (Katalog-Review 1.3.0): every list of pop-ups stays finite.
const crit = (i, extra) => t("Krit " + i, Object.assign({ key: "k" + i, sticky: true, level: "error" }, extra))
const bounded = list => {
  assert.ok(list.filter(x => x.sticky).length <= L.maxSticky, "sticky " + list.filter(x => x.sticky).length)
  assert.ok(list.filter(x => !x.sticky).length <= L.maxLoose, "loose " + list.filter(x => !x.sticky).length)
  for (const x of list) assert.ok(!x.names || x.names.length <= L.maxNames, "names")
}

test("Grenze: wiederholt normale Meldungen falten zu einer Sammelmeldung mit Zahl, Namen begrenzt", () => {
  let queue = []
  for (let i = 1; i <= 5000; i++) { queue = L.fold(queue, [t("n" + i)], i); bounded(queue) }
  // a summary plus the newest single ones, which the next fold takes in
  assert.deepEqual([L.countOf(queue), queue[0].names], [5000, ["n1", "n2", "n3", "n4"]])
  assert.match(queue[0].title, /^\d+ Meldungen$/)
})

test("Grenze: wiederholt kritische Meldungen: höchstens maxSticky, die ältesten als eine Sammelmeldung „N wichtige Meldungen“", () => {
  let queue = []
  for (let i = 1; i <= 2000; i++) { queue = L.fold(queue, [crit(i), t("n" + i)], i); bounded(queue) }
  const sticky = queue.filter(x => x.sticky)
  assert.equal(sticky.length, L.maxSticky)
  const sum = sticky[0]
  assert.deepEqual([sum.title, sum.count, sum.level, sum.sticky, sum.names.length], ["1991 wichtige Meldungen", 1991, "error", true, 4])
  assert.ok(sum.key, "the critical summary has a key (stickyOnes, restoreSticky)")
  // the newest nine stay single and in order
  assert.deepEqual(sticky.slice(1).map(x => x.title), Array.from({ length: 9 }, (_, i) => "Krit " + (1992 + i)))
  assert.equal(L.countOf(queue.filter(x => !x.sticky)), 2000)
  // an appointment only (info) keeps the summary from turning red
  let events = []
  for (let i = 1; i <= 12; i++) events = L.fold(events, [crit(i, { level: "info" })], i)
  assert.equal(events[0].level, "info")
  // it is kept over a restart like the critical ones themselves
  const back = L.restoreSticky(JSON.stringify(L.storedSticky(L.stickyOnes(null, queue, []), "full")))
  assert.deepEqual(back.map(x => x.title), sticky.map(x => x.title))
})

test("Grenze: lange Pause hält zurück, ohne zu wachsen, und gibt bei der Rückkehr alles als Zahl weiter", () => {
  let held = []
  for (let i = 1; i <= 3000; i++) {
    const items = [t("n" + i), t("Lautstärke", { ephemeral: true }), t("Lied", { media: true })]
    if (i % 3 === 0) items.push(crit(i))
    held = L.hold(held, items, i)
    bounded(held)
  }
  assert.equal(held.some(x => x.ephemeral || x.media), false)
  const back = L.welcomeBack(held, 4000)
  const loose = back.filter(x => !x.sticky)
  assert.deepEqual([loose.length, loose[0].title, loose[0].count], [1, "Während du weg warst: 3000 Meldungen", 3000])
  const sticky = back.filter(x => x.sticky)
  assert.equal(sticky.length, L.maxSticky)
  assert.equal(sticky.reduce((n, x) => n + (x.count || 1), 0), 1000)
})

test("Grenze: offene Ansicht: was währenddessen kommt, bleibt begrenzt und kommt beim Schließen als eine Meldung", () => {
  const open = L.onOpen(t("auf dem Schirm"), [t("a"), t("b")], [])
  let held = open.heldBack
  for (let i = 1; i <= 1000; i++) { held = L.hold(held, [t("n" + i)], i); bounded(held) }
  const after = L.afterOpen(held, 2000)
  assert.deepEqual([after.length, after[0].title, after[0].count], [1, "1002 Meldungen", 1002])
  // a single summary is renamed too, with the newest time
  assert.equal(L.welcomeBack([L.fold([], [t("a"), t("b"), t("c"), t("d")], 1)[0]], 9)[0].title, "Während du weg warst: 4 Meldungen")
})

test("Grenze: Text je Pop-up gekürzt, auch bei riesigen Titeln bleibt die Liste klein", () => {
  const N = require("./lib/load").load("NoteLogic.js")
  const huge = "x".repeat(1000000)
  const toast = N.noteToast({ key: "a", app: "a", summary: huge, body: huge, urgency: 2, actions: [] })
  assert.deepEqual([toast.title.length, toast.body.length, toast.title.slice(-1)], [N.maxText, N.maxText, "…"])
  const textTitle = N.noteToast({ key: "b", app: "a", summary: "", body: huge, urgency: 1, actions: [] })
  assert.equal(textTitle.title.length, N.maxText)
  const small = { time: 2, title: "kurz", body: "" }
  const news = L.freshNews([{ time: 3, title: huge, body: huge }, small], 1, () => false)
  assert.deepEqual([news[0], news[1].title.length, news[1].body.length], [small, N.maxText, N.maxText])
  let held = []
  for (let i = 1; i <= 200; i++) held = L.hold(held, [N.noteToast({ key: "k" + i, app: "a", summary: huge, body: huge, urgency: i % 2 ? 2 : 1, actions: [] })], i)
  assert.ok(JSON.stringify(held).length < (L.maxSticky + L.maxLoose) * 3 * N.maxText, JSON.stringify(held).length)
})

test("Grenze: ohne Text gespeichert verliert eine kritische Sammelmeldung ihre Namen", () => {
  let queue = []
  for (let i = 1; i <= 12; i++) queue = L.fold(queue, [crit(i)], i)
  const stored = L.storedSticky(L.stickyOnes(null, queue, []), "noText")
  assert.deepEqual([stored[0].names, stored[0].body, stored[0].count], [[], "", 3])
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
  assert.equal(L.checkLabel({ running: false, done: true, failed: true, found: 0 }), "hat nicht geklappt")
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
