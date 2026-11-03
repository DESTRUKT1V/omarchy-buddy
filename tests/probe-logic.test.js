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
