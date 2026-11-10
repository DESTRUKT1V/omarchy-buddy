"use strict"
// Pasting into the text fields (#252): the bounded wl-paste command, run for
// real against a stand-in wl-paste, and when a finished paste may still insert.
const test = require("node:test")
const assert = require("node:assert/strict")
const fs = require("node:fs")
const os = require("node:os")
const path = require("node:path")
const { spawn } = require("node:child_process")
const L = require("./lib/load").load("PasteLogic.js")

// A folder with a wl-paste that runs `script` (sh) and notes its pid.
function fakePaste(script) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "buddy-paste-"))
  fs.writeFileSync(path.join(dir, "wl-paste"), "#!/bin/sh\necho $$ > \"$(dirname \"$0\")/pid\"\necho \"$@\" > \"$(dirname \"$0\")/args\"\n" + script + "\n", { mode: 0o755 })
  return dir
}
const alive = pid => { try { process.kill(pid, 0); return true } catch (e) { return false } }
// Runs the command like the island's Process; `whileRunning(child)` may cancel it.
function run(dir, primary, whileRunning) {
  return new Promise(resolve => {
    const t0 = Date.now()
    const child = spawn(L.command(primary)[0], L.command(primary).slice(1), { env: Object.assign({}, process.env, { PATH: dir + ":" + process.env.PATH }) })
    const chunks = []
    child.stdout.on("data", c => chunks.push(c))
    child.on("close", () => resolve({ out: Buffer.concat(chunks), ms: Date.now() - t0 }))
    if (whileRunning) whileRunning(child)
  })
}
const pidOf = dir => Number(fs.readFileSync(path.join(dir, "pid"), "utf8"))
const waitFor = async (check, ms) => { const end = Date.now() + ms; while (Date.now() < end && !check()) await new Promise(r => setTimeout(r, 50)); return check() }

test("Einfügen: normaler Text kommt ganz an, Strg+V aus der Zwischenablage, Mittelklick aus der Auswahl", async () => {
  const dir = fakePaste("printf 'Grüße\\nzwei'")
  const r = await run(dir, false)
  assert.equal(r.out.toString("utf8"), "Grüße\nzwei")
  assert.doesNotMatch(fs.readFileSync(path.join(dir, "args"), "utf8"), /--primary/)
  await run(dir, true)
  assert.match(fs.readFileSync(path.join(dir, "args"), "utf8"), /--type text --primary/)
})

test("Einfügen: zu viel Text endet ein Byte nach der Grenze und wird nicht eingefügt", async () => {
  const dir = fakePaste("yes Zeile")
  const r = await run(dir, false)
  assert.equal(r.out.length, L.maxBytes + 1)
  assert.ok(r.ms < 1500, "endlos liefernd endet gleich nach der Grenze: " + r.ms)
  const req = L.snapshot(1, "", 0, 0, 0)
  assert.equal(L.result(req, 1, L.snapshot(1, "", 0, 0, 0), true, r.out.toString("utf8")), null)
  assert.ok(await waitFor(() => !alive(pidOf(dir)), 1000), "wl-paste ist weg")
})

test("Einfügen: zu langsam endet nach der festen Zeitgrenze, auch wer SIGTERM ignoriert", async () => {
  const dir = fakePaste("trap '' TERM\nwhile :; do printf a; sleep 0.2; done")
  const r = await run(dir, false)
  assert.ok(r.ms < (L.limitSeconds + 1) * 1000 + 700, "endet nach Grenze + Nachfrist: " + r.ms)
  assert.ok(r.ms >= L.limitSeconds * 1000 - 100)
  assert.ok(await waitFor(() => !alive(pidOf(dir)), 1000), "wl-paste ist weg")
})

// Like the real wl-paste, which hands the transfer to a `cat` of its own.
const withChild = "d=$(dirname \"$0\")\nsh -c 'echo $$ > \"$1/child\"; exec sleep 30' sh \"$d\" &\nwait"
const childOf = dir => Number(fs.readFileSync(path.join(dir, "child"), "utf8"))

test("Einfügen: Abbrechen (SIGTERM wie Process.signal(15)) beendet die ganze Kette sofort", async () => {
  const dir = fakePaste(withChild)
  const r = await run(dir, false, child => setTimeout(() => child.kill("SIGTERM"), 300))
  assert.ok(r.ms < 1000, "sofort zu Ende: " + r.ms)
  assert.ok(await waitFor(() => !alive(pidOf(dir)) && !alive(childOf(dir)), 500), "wl-paste und sein Kind sind weg")
})

// With coreutils 9.12 the inner timeout mostly ends with the outer one at
// once (it may also run on until its limit): either way gone in time.
test("Einfügen: stirbt die Insel (SIGKILL), endet wl-paste samt Kind spätestens nach der Grenze", async () => {
  const dir = fakePaste(withChild)
  await run(dir, false, child => setTimeout(() => child.kill("SIGKILL"), 300))
  assert.ok(await waitFor(() => !alive(pidOf(dir)) && !alive(childOf(dir)), (L.limitSeconds + 2) * 1000), "endet von selbst")
})

test("Einfügen: das Ergebnis gilt nur für die wartende Anfrage am unveränderten Feld", () => {
  const req = L.snapshot(3, "abc", 1, 2, 2)
  const same = L.snapshot(3, "abc", 1, 2, 2)
  assert.deepEqual(L.result(req, 3, same, true, "XY"), { start: 1, end: 2, text: "XY" }, "ersetzt die Auswahl")
  assert.equal(L.result(null, 3, same, true, "XY"), null, "abgebrochen")
  assert.equal(L.result(req, 2, same, true, "XY"), null, "ältere Anfrage, neuere wartet")
  assert.equal(L.result(req, 3, same, false, "XY"), null, "Fokus weg oder geschlossen")
  assert.equal(L.result(req, 3, L.snapshot(3, "abcd", 1, 2, 2), true, "XY"), null, "Text geändert")
  assert.equal(L.result(req, 3, L.snapshot(3, "abc", 0, 2, 2), true, "XY"), null, "Auswahl geändert")
  assert.equal(L.result(req, 3, L.snapshot(3, "abc", 1, 2, 1), true, "XY"), null, "Cursor bewegt")
  assert.equal(L.result(req, 3, same, true, ""), null, "leer")
  assert.deepEqual(L.result(L.snapshot(4, "abc", 1, 2, 2), 4, L.snapshot(4, "abc", 1, 2, 2), true, "XY").text, "XY", "erneuter Versuch klappt")
})

test("Einfügen: „Zu viel zum Einfügen“ nur bei Überlänge an der wartenden Anfrage (#260)", () => {
  const req = L.snapshot(5, "abc", 1, 1, 1)
  const same = L.snapshot(5, "abc", 1, 1, 1)
  const big = "a".repeat(L.maxBytes + 1)
  assert.equal(L.tooMuch(req, 5, same, true, big), true, "zu viel")
  assert.equal(L.tooMuch(req, 5, same, true, "a".repeat(L.maxBytes)), false, "genau an der Grenze wird eingefügt")
  assert.equal(L.tooMuch(req, 5, same, true, ""), false, "leer")
  assert.equal(L.tooMuch(req, 5, same, true, undefined), false, "nichts geliefert")
  assert.equal(L.tooMuch(null, 5, same, true, big), false, "abgebrochen (auch nach der Zeitgrenze der Insel)")
  assert.equal(L.tooMuch(req, 4, same, true, big), false, "ältere Anfrage")
  assert.equal(L.tooMuch(req, 5, same, false, big), false, "Fokus weg oder geschlossen")
  assert.equal(L.tooMuch(req, 5, L.snapshot(5, "abcd", 1, 1, 1), true, big), false, "Feld geändert")
  assert.equal(L.result(req, 5, same, true, big), null, "und eingefügt wird dann nichts")
})

test("Einfügen: die Grenze zählt UTF-8-Bytes, nicht Zeichen", () => {
  const req = L.snapshot(1, "", 0, 0, 0)
  const ok = s => L.result(req, 1, L.snapshot(1, "", 0, 0, 0), true, s) !== null
  assert.equal(ok("a".repeat(L.maxBytes)), true)
  assert.equal(ok("a".repeat(L.maxBytes + 1)), false)
  assert.equal(ok("ü".repeat(L.maxBytes / 2)), true)
  assert.equal(ok("ü".repeat(L.maxBytes / 2) + "a"), false)
  assert.equal(L.utf8Bytes("😀�"), 7)
})

test("Einfügen: Strg+V, Umschalt+Einfg und die Einfügetaste, sonst nichts", () => {
  assert.equal(L.isPasteKey(true, 0x56, 0x04000000), true)
  assert.equal(L.isPasteKey(false, L.keyInsert, L.shiftModifier), true)
  assert.equal(L.isPasteKey(false, L.keyPaste, 0), true)
  assert.equal(L.isPasteKey(false, L.keyInsert, 0), false)
  assert.equal(L.isPasteKey(false, 0x56, 0), false)
})

test("Einfügen: die Insel wartet länger als der Befehl höchstens läuft", () => {
  assert.ok(L.deadlineMs > (L.limitSeconds + 1 + 1) * 1000, "äußeres timeout samt Nachfrist")
})

test("Einfügen: nur ein Befehl, der selbst endet, bringt Text – nie ein halber nach Zeitgrenze oder Signal", async () => {
  assert.equal(L.outputOf(0, true, "abc"), "abc")
  assert.equal(L.outputOf(124, true, "ab"), "", "timeout")
  assert.equal(L.outputOf(137, true, "ab"), "", "nach KILL")
  assert.equal(L.outputOf(15, false, "ab"), "", "abgestürzt / Signal")
  // the real command: a slow wl-paste brings part, then the limit ends it with a non-zero code
  const dir = fakePaste("printf teil; sleep 30")
  const code = await new Promise(resolve => {
    const child = spawn(L.command(false)[0], L.command(false).slice(1), { env: Object.assign({}, process.env, { PATH: dir + ":" + process.env.PATH }) })
    child.stdout.resume()
    child.on("exit", c => resolve(c))
  })
  assert.notEqual(code, 0, "Zeitgrenze endet nicht mit 0")
  // too much still ends with 0 (head stops one byte past the limit), so the hint can show
  const big = fakePaste("yes Zeile")
  const bigCode = await new Promise(resolve => {
    const child = spawn(L.command(false)[0], L.command(false).slice(1), { env: Object.assign({}, process.env, { PATH: big + ":" + process.env.PATH }) })
    child.stdout.resume()
    child.on("exit", c => resolve(c))
  })
  assert.equal(bigCode, 0)
})
