"use strict"
const test = require("node:test")
const assert = require("node:assert/strict")
const L = require("./lib/load").load("ProbeLogic.js")

const note = (key, app, fields) => Object.assign({ key: key, app: app, summary: "s", body: "", urgency: 1,
                                                   time: 1, actions: [], group: app + "\ns" }, fields)

test("Test-IPC: nur Meldungen mit dem Test-Absender gehören dem Test", () => {
  assert.equal(L.isTest(note("1", "Buddy-Test")), true)
  assert.equal(L.isTest(note("2", "Beeper")), false)
  assert.equal(L.isTest(null), false)
  const notes = [note("1", "Beeper"), note("2", "Buddy-Test")]
  assert.equal(L.testNote(notes, "2").key, "2")
  assert.equal(L.testNote(notes, "1"), null, "fremde Meldung wird nie angefasst")
  assert.equal(L.testNote(notes, "3"), null)
})

test("Test-IPC: Bündel der Testmeldungen, jedes einmal", () => {
  const notes = [note("1", "Buddy-Test"), note("2", "Buddy-Test"),
                 note("3", "Buddy-Test", { group: "Buddy-Test\nb" }), note("4", "Beeper")]
  assert.deepEqual(L.testGroups(notes), ["Buddy-Test\ns", "Buddy-Test\nb"])
})

test("Test-IPC: Zustand als schlichtes JSON", () => {
  const notes = []
  for (let i = 0; i < 20; i++) notes.push(note(String(i), "Buddy-Test", { actions: [{ id: "open", text: "Öffnen" }] }))
  const session = { id: "sid", requests: [] }
  const snap = L.snapshot({
    mode: "needs", opened: false, peeking: false, quiet: true, sharing: false, silent: true,
    veiled: false, settingsShown: true, settings: { zoom: 0 }, settingsBroken: false,
    away: false, fullscreen: false, paused: false,
    toast: { title: "Hallo", body: "b", key: "k", sticky: true, note: true, extra: {} },
    queue: [{ title: "4 Neuigkeiten", count: 4 }], heldBack: [1, 2], notes: notes,
    ask: { key: "sid/r1", session: session, request: { id: "r1", tool: "Bash", detail: "rm x" } },
    asks: [1], sessions: [session], news: [{ title: "Update", time: 1 }]
  }, key => key === "0")
  assert.deepEqual(snap.toast, { title: "Hallo", body: "b", app: "", source: "", key: "k", count: 1, sticky: true, note: true, kind: "" })
  assert.deepEqual(snap.queue.map(t => [t.title, t.count, t.sticky]), [["4 Neuigkeiten", 4, false]])
  assert.equal(snap.heldBack, 2)
  assert.equal(snap.notes.length, L.noteLimit)
  assert.equal(snap.noteCount, 20)
  assert.deepEqual(snap.notes[0].actions, ["open"])
  assert.deepEqual([snap.notes[0].live, snap.notes[1].live], [true, false])
  assert.deepEqual(snap.ask, { session: "sid", request: "r1", tool: "Bash", detail: "rm x", kind: "", truncated: false, questions: 0 })
  assert.deepEqual([snap.mode, snap.quiet, snap.asks, snap.sessions], ["needs", true, 1, 1])
  assert.deepEqual([snap.veiled, snap.settingsShown, snap.settings, snap.settingsBroken], [false, true, { zoom: 0 }, false])
  assert.deepEqual(snap.news, ["Update"])
  assert.doesNotThrow(() => JSON.stringify(snap))
})

test("Test-IPC: Rückfrage im Terminal hat keine Anfrage", () => {
  assert.deepEqual(L.askBrief({ session: { id: "s" }, request: null }),
                   { session: "s", request: "", tool: "", detail: "", kind: "", truncated: false, questions: 0 })
  assert.deepEqual(L.askBrief({ session: { id: "s" }, request: { id: "r", kind: "question", truncated: true, questions: [{}, {}] } }),
                   { session: "s", request: "r", tool: "", detail: "", kind: "question", truncated: true, questions: 2 })
  assert.equal(L.askBrief(null), null)
  assert.equal(L.toastBrief(null), null)
})

const rect = (x, y, w, h) => ({ x, y, w, h })
const island = { rect: rect(0, 0, 500, 300) }
const win = { rect: rect(-100, -40, 700, 400) }

test("Test-IPC: Knopf im Fenster ist erreichbar, abgeschnittener nicht", () => {
  assert.equal(L.reachable(rect(10, 250, 80, 30), [island, win]), true)
  assert.equal(L.reachable(rect(10, 290, 80, 30), [island, win]), false, "unten aus der Insel")
  assert.equal(L.reachable(rect(450, 10, 80, 30), [island, win]), false, "rechts abgeschnitten (B6)")
  assert.equal(L.reachable(rect(10, 250.5, 80, 50.4), [island, win]), true, "1 px Rundung")
})

test("Test-IPC: in einer scrollenden Fläche erreichbar, in einer festen nicht", () => {
  const flick = { rect: rect(10, 40, 400, 200), flick: true, interactive: true }
  assert.equal(L.reachable(rect(20, 600, 100, 30), [flick, island, win]), true, "hinscrollen")
  assert.equal(L.reachable(rect(20, 600, 100, 30), [Object.assign({}, flick, { interactive: false }), island, win]), false,
               "Fläche scrollt nicht (B1)")
  assert.equal(L.reachable(rect(380, 600, 100, 30), [flick, island, win]), false, "seitlich hilft Scrollen nicht")
  const tooTall = { rect: rect(10, 40, 400, 400), flick: true, interactive: true }
  assert.equal(L.reachable(rect(20, 600, 100, 30), [tooTall, island, win]), false, "Fläche selbst ragt aus der Insel")
  const clipped = { rect: rect(10, 40, 400, 50) }
  assert.equal(L.reachable(rect(20, 100, 100, 30), [clipped, island, win]), false, "Rahmen mit clip schneidet ab")
})

test("Test-IPC: layout nennt die unerreichbaren", () => {
  const out = L.layout({ mode: "needs", island: rect(0, 0, 500, 300), window: win.rect, flicks: [],
    items: [{ name: "Erlauben", enabled: true, rect: rect(10, 250, 80, 30), clips: [island, win], truncated: false },
            { name: "Ablehnen", enabled: true, rect: rect(450, 250, 80, 30), clips: [island, win], truncated: false }] })
  assert.deepEqual(out.unreachable, ["Ablehnen"])
  assert.deepEqual(out.items.map(i => [i.name, i.reach, i.w]), [["Erlauben", true, 80], ["Ablehnen", false, 80]])
})

// #256: the test acts only on its own things, decided at the moment it acts.
const sess = (id) => ({ id: id, requests: [{ id: "r1" }] })
const ask = (id) => ({ key: id + "/r1", session: sess(id), request: { id: "r1" } })
const ctx = (notes, extra) => Object.assign({ notes: notes, removed: [], canUndo: false, testPlayer: false }, extra)
const calm = (extra) => Object.assign({ asks: [], toast: null, queue: [], heldBack: [], opened: false, viewByTest: false,
                                         settingsShown: false, settingsByTest: false, paused: false, known: null, records: [] }, extra)

test("Test-IPC: Besitzer eines Knopfs, vom nächsten Elternteil aufwärts", () => {
  assert.deepEqual(L.owner([{}, { ask: ask("buddy-test-1") }, { ask: ask("echt") }]), { kind: "session", id: "buddy-test-1" })
  assert.deepEqual(L.owner([{ session: sess("echt") }]), { kind: "session", id: "echt" })
  assert.deepEqual(L.owner([{ model: { label: "Möglichkeit" } }, { model: sess("s") }]), { kind: "session", id: "s" },
                   "Auswahlzeile einer Frage gehört zur Sitzung darüber")
  const n = note("k1", "Buddy-Test")
  assert.equal(L.owner([{ note: n }]).id, "k1")
  assert.equal(L.owner([{ model: n }]).kind, "note")
  assert.deepEqual(L.owner([{ marker: "view" }, { ask: ask("buddy-test-1") }]), { kind: "view" })
  assert.deepEqual(L.owner([{ ask: {} }, { session: {} }, {}]), { kind: "none" }, "leere Vorgaben zählen nicht")
})

test("Test-IPC: nur die genannte Testsitzung, nie eine echte", () => {
  const own = { kind: "session", id: "buddy-test-1" }
  assert.equal(L.allows(own, "buddy-test-1", ctx([])), true)
  assert.equal(L.allows(own, "buddy-test-2", ctx([])), false, "andere Testsitzung als gemeint")
  assert.equal(L.allows({ kind: "session", id: "echt" }, "echt", ctx([])), false, "echte Sitzung, auch wenn genannt")
  assert.equal(L.allows({ kind: "none" }, "view", ctx([])), false, "Unbekanntes nie")
  assert.equal(L.allows({ kind: "view" }, "view", ctx([])), true)
  assert.equal(L.allows({ kind: "view" }, "buddy-test-1", ctx([])), false)
  assert.equal(L.allows({ kind: "player" }, "player", ctx([])), false, "Musik des Nutzers")
  assert.equal(L.allows({ kind: "player" }, "player", ctx([], { testPlayer: true })), true)
})

test("Test-IPC: Meldung nur, wenn sie und ihr ganzes Bündel dem Test gehören", () => {
  const mine = note("k1", "Buddy-Test"), real = note("k2", "Beeper")
  assert.equal(L.allows({ kind: "note", id: "k1", item: mine }, "k1", ctx([mine, real])), true)
  assert.equal(L.allows({ kind: "note", id: "k2", item: real }, "k2", ctx([mine, real])), false)
  const said = note("buddy-test-x", "", { group: "\nFertig" }), saidReal = note("echt", "", { group: "\nFertig" })
  assert.equal(L.allows({ kind: "note", id: "buddy-test-x", item: said }, "buddy-test-x", ctx([said, saidReal])), false,
               "× löscht das Bündel mit der echten gleichnamigen Meldung")
})

test("Test-IPC: alle löschen und Rückgängig nur über reine Testmeldungen", () => {
  const mine = note("k1", "Buddy-Test"), real = note("k2", "Beeper")
  const hist = { kind: "history" }
  assert.equal(L.allows(hist, "history", ctx([mine])), true)
  assert.equal(L.allows(hist, "history", ctx([mine, real])), false, "echter Verlauf")
  assert.equal(L.allows(hist, "history", ctx([real], { canUndo: true, removed: [mine] })), true, "Rückgängig holt nur Testmeldungen")
  assert.equal(L.allows(hist, "history", ctx([mine], { canUndo: true, removed: [real] })), false,
               "Rückgängig würde das Löschen des Nutzers zurücknehmen")
  const snap = L.snapshot(Object.assign(calm(), { mode: "pill", notes: [mine, real], sessions: [], news: [] }), () => false)
  assert.equal(snap.realNotes, 1)
})

test("Test-IPC: Sammel-Pop-up gehört dem Test nur, wenn alles darin seins ist", () => {
  assert.equal(L.isTest({ title: "6 Meldungen", testOnly: true }), true)
  assert.equal(L.isTest({ title: "6 Meldungen", testOnly: false }), false)
  assert.equal(L.isTest({ title: "6 Meldungen" }), false)
  assert.equal(L.isTest({ key: "buddy-test-run-fertig", source: "claude" }), true, "omarchy-buddy-say mit Testschlüssel")
  assert.equal(L.isTest({ key: "done-buddy-test-1x-1700", source: "claude" }), true, "Hook: Testsitzung fertig")
  assert.equal(L.isTest({ key: "done-4f1c-1700", source: "claude" }), false)
})

test("Test-IPC: Omarchys IPC nur, wenn alles Getroffene dem Test gehört", () => {
  const mine = { app: "Buddy-Test", key: "1" }, real = { app: "Beeper", key: "2" }
  const t = (m, s) => L.omarchyTargets(m, Object.assign({ mode: "toast", toast: mine, queue: [] }, s))
  assert.deepEqual(t("act"), [mine])
  assert.deepEqual(t("act", { mode: "needs" }), [], "Pop-up hinter einer Rückfrage wird nicht getroffen")
  assert.deepEqual(t("dismissAll", { queue: [real] }), [mine, real])
  assert.deepEqual(t("dismiss", { mode: "needs", queue: [real] }), [mine, real])
  assert.deepEqual(t("showHistory"), [])
  assert.equal(t("clear"), null, "den ganzen Verlauf leeren darf der Test nie")
})

test("Test-IPC: echte Ankunft zwischen Beobachten und Klicken stoppt den Lauf", () => {
  assert.equal(L.interruption(calm({ asks: [ask("buddy-test-1")], toast: { app: "Buddy-Test", key: "1" } })), "")
  // The test saw its own request; before its click a real one arrives.
  assert.equal(L.interruption(calm({ asks: [ask("buddy-test-1"), ask("echt")] })), "ask")
  assert.equal(L.interruption(calm({ toast: { app: "Buddy-Test", key: "1" }, queue: [{ app: "Beeper", key: "2" }] })), "popup")
  assert.equal(L.interruption(calm({ heldBack: [{ app: "Beeper", key: "2" }] })), "popup", "auch zurückgehalten (offene Ansicht)")
  assert.equal(L.interruption(calm({ paused: true })), "away")
  // Silently (Ruhemodus, sharing, low urgency): only the history and the news get it.
  const old = note("k1", "Beeper"), mine = note("k2", "Buddy-Test"), fresh = note("k3", "Beeper")
  const known = L.realKeys([old, mine])
  assert.deepEqual(known, { k1: true })
  assert.equal(L.interruption(calm({ known: known, records: [mine, old] })), "")
  assert.equal(L.interruption(calm({ known: known, records: [fresh, mine, old] })), "popup")
  assert.equal(L.interruption(calm({ known: known, records: [{ key: "update", title: "Update", time: 2 }] })), "popup", "eine Neuigkeit")
  assert.equal(L.interruption(calm({ known: L.realKeys([{ key: "", time: 1 }]), records: [{ key: "", time: 2 }] })), "popup",
               "Neuigkeit ohne Schlüssel")
  // And the click itself is bound to the test's session: the real request's
  // button with the same label is never the one clicked.
  assert.equal(L.allows(L.owner([{ ask: ask("echt") }]), "buddy-test-1", ctx([])), false)
})

test("Test-IPC: Ansichtswechsel durch den Nutzer stoppt den Lauf, der des Tests nicht", () => {
  assert.equal(L.interruption(calm({ opened: true, viewByTest: true })), "")
  assert.equal(L.interruption(calm({ opened: true })), "view", "der Nutzer öffnet die große Ansicht")
  assert.equal(L.interruption(calm({ opened: true, viewByTest: true, settingsShown: true })), "view",
               "der Nutzer öffnet die Einstellungen in der Ansicht des Tests")
  // In the open view a real session's "Erlauben" stands beside the test's:
  // only the test's own may be clicked.
  const buttons = [[{}, { session: sess("echt") }], [{}, { session: sess("buddy-test-1") }]]
  assert.deepEqual(buttons.map(b => L.allows(L.owner(b), "buddy-test-1", ctx([]))), [false, true])
})
