"use strict"
const test = require("node:test")
const assert = require("node:assert/strict")
const D = require("./lib/load").load("DiffLogic.js")

const kinds = d => d.rows.map(r => r.kind === "gap" ? "gap" + r.count : r.kind[0] + (r.text || "")).join(" ")

test("Edit: eine Zeile geändert, Kontext bleibt", () => {
  const d = D.diff([{ file: "/p/a.py", old: "x = 1\ny = 2\nz = 3\n", new: "x = 1\ny = 20\nz = 3\n" }])
  assert.equal(kinds(d), "sx = 1 dy = 2 ay = 20 sz = 3")
  assert.equal(d.added, 1)
  assert.equal(d.removed, 1)
  assert.equal(D.title(d, false, "/p", "de"), "a.py")
})

test("Write einer neuen Datei: alles +, Titel sagt neu", () => {
  const d = D.diff([{ file: "/p/neu.md", old: "", new: "# Titel\n\nText", created: true }])
  assert.equal(kinds(d), "a# Titel a aText")
  assert.equal(D.title(d, true, "/p/", "de"), "neu.md (neu)")
  assert.equal(D.title(d, true, "/q", "en"), "/p/neu.md (new)")
})

test("Einfügen mitten drin: nur die neuen Zeilen sind +", () => {
  const d = D.diff([{ file: "f", old: "a\nb\nc\nd", new: "a\nb\nNEU\nc\nd" }])
  assert.equal(kinds(d), "sa sb aNEU sc sd")
})

test("Ersetzen: erst −, dann +", () => {
  const d = D.diff([{ file: "f", old: "a\nb\nc\nz", new: "a\nx\ny\nz" }])
  assert.equal(kinds(d), "sa db dc ax ay sz")
})

test("Lange unveränderte Strecken werden zu einer Lücke mit Zeilenzahl", () => {
  const same = Array.from({ length: 20 }, (_, i) => "l" + i)
  const d = D.diff([{ file: "f", old: ["A", ...same, "B"].join("\n"), new: ["A2", ...same, "B2"].join("\n") }])
  assert.equal(kinds(d), "dA aA2 sl0 sl1 sl2 gap14 sl17 sl18 sl19 dB aB2")
  assert.equal(D.gapText(14, "de"), "14 Zeilen unverändert")
  assert.equal(D.gapText(1, "en"), "1 unchanged line")
  // am Anfang und Ende nur der Kontext zur Änderung hin
  const e = D.diff([{ file: "f", old: [...same, "X"].join("\n"), new: [...same, "Y"].join("\n") }])
  assert.equal(kinds(e), "gap17 sl17 sl18 sl19 dX aY")
})

test("MultiEdit: Stellen derselben Datei getrennt, mehrere Dateien mit Dateizeile", () => {
  const d = D.diff([{ file: "/p/a", old: "1", new: "2" }, { file: "/p/a", old: "3", new: "4" }])
  assert.equal(kinds(d), "d1 a2 gap0 d3 a4")
  assert.equal(D.gapText(0, "de"), "nächste Stelle")
  const m = D.diff([{ file: "/p/a", old: "1", new: "2" }, { file: "/p/b", old: "", new: "x", created: true }])
  assert.equal(kinds(m), "f/p/a d1 a2 f/p/b ax")
  assert.equal(D.title(m, false, "/p", "de"), "2 Dateien")
})

test("Sehr groß: höchstens maxRows Zeilen, der Rest gezählt; Zählung über alles", () => {
  const big = Array.from({ length: 1000 }, (_, i) => "z" + i).join("\n")
  const d = D.diff([{ file: "f", old: "", new: big, created: true }])
  assert.equal(d.rows.length, D.maxRows)
  assert.equal(d.cut, 1000 - D.maxRows)
  assert.equal(d.added, 1000)
})

test("Zu viele Zeilen für den genauen Vergleich: erst alles −, dann alles +", () => {
  const a = Array.from({ length: 600 }, (_, i) => "a" + i), b = Array.from({ length: 600 }, (_, i) => "b" + i)
  const d = D.diff([{ file: "f", old: a.join("\n"), new: b.join("\n") }])
  assert.equal(d.removed, 600)
  assert.equal(d.added, 600)
  assert.equal(d.rows[0].kind, "del")
  assert.equal(d.rows[D.maxRows - 1].kind, "del")
  assert.equal(d.cut, 1200 - D.maxRows)
})

test("Kaputte Eingaben: nichts", () => {
  assert.deepEqual(D.diff(null), { rows: [], added: 0, removed: 0, files: [], cut: 0 })
  assert.deepEqual(D.diff([null, 3]).rows, [])
  assert.equal(kinds(D.diff([{ file: "f", old: "same", new: "same" }])), "ssame")
})

test("Farben: rot und grün in jedem Theme, Text und Zeichen mit 4,5:1", () => {
  const I = require("./lib/load").load("IslandLogic.js")
  const rgb = h => ({ r: parseInt(h.substr(1, 2), 16) / 255, g: parseInt(h.substr(3, 2), 16) / 255, b: parseInt(h.substr(5, 2), 16) / 255 })
  const themes = [["#cacccc", "#101315"], ["#c0caf5", "#1a1b26"], ["#575279", "#faf4ed"], ["#000000", "#ffffff"],
                  ["#100f0f", "#fffcf0"], ["#ffffff", "#000000"], ["#ebdbb2", "#282828"]]
  for (const [f, b] of themes) {
    const fg = rgb(f), bg = rgb(b), light = I.isLight(bg.r, bg.g, bg.b)
    const c = D.colors(fg, bg, light)
    for (const row of [c.addRow, c.delRow]) assert.ok(I.contrast(fg, row) >= 4.5, `${f}/${b} Text`)
    for (const [ink, row] of [[c.addInk, c.addRow], [c.delInk, c.delRow]])
      for (const s of [bg, c.box, row]) assert.ok(I.contrast(ink, s) >= 4.5, `${f}/${b} Zeichen`)
    assert.ok(c.addRow.g > c.addRow.r && c.addInk.g > c.addInk.r, `${f}/${b} grün`)
    assert.ok(c.delRow.r > c.delRow.g && c.delInk.r > c.delInk.g, `${f}/${b} rot`)
    assert.ok(I.distance(c.addRow, c.box) > 8 && I.distance(c.delRow, c.box) > 8, `${f}/${b} Tönung sichtbar`)
  }
})

test("Edits als Qt-Liste (Repeater-Modell der großen Ansicht), nicht nur als JS-Array", () => {
  const edit = { file: "/x/a", old: "1", new: "2", created: false }
  const list = { length: 1, 0: edit }  // so kommt eine QVariantList in JS an
  assert.deepEqual(D.diff(list).rows, D.diff([edit]).rows)
  assert.equal(D.diff("kaputt").rows.length, 0)
  assert.equal(D.diff(null).rows.length, 0)
})
